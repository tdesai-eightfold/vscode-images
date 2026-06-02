# shellcheck shell=bash
# start-java: scaffold a Java project with Maven or Gradle via mise.
# Sourced from /home/candidate/.bashrc so the function is available in the candidate shell.

start-java() {
  local workspace_dir="/home/candidate/workspace"

  # Pinned toolchain versions for reproducible candidate environments.
  # Keep java_version in sync with the java@ build arg passed to docker build
  # so the image does not download a second JDK on first start-java run.
  # Do NOT use *@latest here: a newer JDK can drop support for the source/target
  # level the Maven archetype emits (e.g. JDK 20+ removed -source/-target 7).
  local java_version="21"
  local maven_version="3.9.11"
  local gradle_version="8.14"

  local build_tool_choice

  echo "Select a Java build tool:"
  echo "  1) Maven"
  echo "  2) Gradle"
  printf "Enter choice [1-2]: "
  read -r build_tool_choice

  local build_tool
  case "$build_tool_choice" in
    1 | maven | Maven | MAVEN) build_tool="maven" ;;
    2 | gradle | Gradle | GRADLE) build_tool="gradle" ;;
    *)
      echo "Invalid choice. Run start-java again and pick 1 or 2." >&2
      return 1
      ;;
  esac

  # Maven and Gradle both need a JDK on PATH to build or run anything.
  echo "Setting up java@${java_version} (required by $build_tool)..."
  mise use -g "java@${java_version}" || {
    echo "Failed to install java via mise." >&2
    return 1
  }

  local build_tool_version
  if [ "$build_tool" = "maven" ]; then
    build_tool_version="$maven_version"
  else
    build_tool_version="$gradle_version"
  fi

  echo "Setting up ${build_tool}@${build_tool_version}..."
  mise use -g "${build_tool}@${build_tool_version}" || {
    echo "Failed to install $build_tool via mise." >&2
    return 1
  }

  # Reactivate so the freshly installed shims are on PATH in this shell.
  eval "$(mise activate bash)"
  mise reshim 2>/dev/null

  local project_name
  printf "Project name [demo]: "
  read -r project_name
  project_name="${project_name:-demo}"

  local project_dir="$workspace_dir/$project_name"
  if [ -e "$project_dir" ]; then
    echo "Path already exists: $project_dir" >&2
    return 1
  fi

  if [ "$build_tool" = "maven" ]; then
    (
      cd "$workspace_dir" &&
        mvn -q archetype:generate \
          -DgroupId=com.example \
          -DartifactId="$project_name" \
          -DarchetypeArtifactId=maven-archetype-quickstart \
          -DarchetypeVersion=1.4 \
          -DinteractiveMode=false
    ) || {
      echo "Maven project generation failed." >&2
      return 1
    }

    # The quickstart archetype pins maven.compiler.{source,target} to 1.7, which
    # modern JDKs (20+) reject. Retarget the project to the JDK actually on PATH.
    local java_major
    java_major="$(java -version 2>&1 | head -n1 | sed -e 's/.*version "//' -e 's/^1\.//' -e 's/[.""_-].*//')"
    java_major="${java_major:-$java_version}"
    if [ -f "$project_dir/pom.xml" ]; then
      sed -i \
        -e "s|<maven.compiler.source>[^<]*</maven.compiler.source>|<maven.compiler.source>${java_major}</maven.compiler.source>|" \
        -e "s|<maven.compiler.target>[^<]*</maven.compiler.target>|<maven.compiler.target>${java_major}</maven.compiler.target>|" \
        "$project_dir/pom.xml"

      # Wire in exec-maven-plugin with the main class preconfigured so the
      # project runs via `mvn compile exec:java` (no -Dexec.mainClass needed).
      if ! grep -q "exec-maven-plugin" "$project_dir/pom.xml"; then
        sed -i "s|</build>|  <plugins>\n      <plugin>\n        <groupId>org.codehaus.mojo</groupId>\n        <artifactId>exec-maven-plugin</artifactId>\n        <version>3.5.0</version>\n        <configuration>\n          <mainClass>com.example.App</mainClass>\n        </configuration>\n      </plugin>\n    </plugins>\n  </build>|" "$project_dir/pom.xml"
      fi
    fi

    cat <<EOF

Maven project created at: $project_dir

Run:    cd $project_dir && mvn compile exec:java
EOF
  else
    mkdir -p "$project_dir"
    (
      cd "$project_dir" &&
        gradle init \
          --type java-application \
          --dsl groovy \
          --test-framework junit-jupiter \
          --project-name "$project_name" \
          --package com.example \
          --java-version 21 \
          --no-split-project \
          --no-incubating \
          --use-defaults
    ) || {
      echo "Gradle project generation failed." >&2
      return 1
    }

    cat <<EOF

Gradle project created at: $project_dir

Run:    cd $project_dir && gradle run
EOF
  fi
}
