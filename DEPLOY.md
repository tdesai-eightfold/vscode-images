# Deploying v2-ubuntu-base-container (Terraform + any cloud)

This repo includes **Terraform (HCL)** to run the code-server container on **AWS** or **OCI (Oracle Cloud)**. The same plan works on either provider; you choose via `cloud_provider`.

---

**Note:** Terraform loads both AWS and OCI providers. When deploying only to one cloud, the other provider may still need to be configured (e.g. set dummy env vars or skip `terraform plan` for the unused provider). For strict separation, use separate `terraform` directories per cloud or Terraform workspaces with different tfvars.

## Quick reference

| Step | OCI | AWS |
|------|-----|-----|
| 1. Configure provider | `OCI_CLI_CONFIG` or env vars (see below) | `aws configure` or `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| 2. Set variables | Copy `terraform/terraform.tfvars.example` → `terraform.tfvars`, set `cloud_provider = "oci"` and OCI_* | Set `cloud_provider = "aws"`, `aws_account_id`, etc. |
| 3. Apply Terraform | `cd terraform && terraform init && terraform apply` | Same |
| 4. Build & push image | `./oci-push.sh` (after setting OCI_OCIR_NAMESPACE, OCI_AUTH_TOKEN, OCI_OCIR_USER) | `./aws-push.sh` (set AWS_ACCOUNT_ID, AWS_REGION) |
| 5. Access code-server | OCI Console → Container Instances → instance → copy **Public IP** → `http://<public-ip>` | Use launcher app (ECS tasks get public IP from launcher) |

---

## Deploy on OCI (Oracle Cloud Infrastructure)

### Prerequisites

- OCI account and a compartment
- Terraform **≥ 1.5**
- Docker (for building and pushing the image)
- OCI CLI optional but useful: `brew install oci-cli` then `oci setup`

### 1. OCI credentials (pick one)

**Option A – OCI CLI (recommended)**  
Run `oci setup` and complete the wizard. This writes `~/.oci/config`. Then:

```bash
export OCI_CLI_CONFIG=~/.oci/config
```

**Option B – Environment variables**  
Set these (e.g. in `.env` or your shell):

```bash
export TF_VAR_oci_compartment_id="ocid1.compartment.oc1..aaaaaaaa..."
export TF_VAR_oci_region="ap-tokyo-1"
export TF_VAR_oci_ocir_namespace="axxxxxxxxxx"   # Tenancy namespace (Profile → Tenancy)
export TF_VAR_oci_subnet_id="ocid1.subnet.oc1..aaaaaaaa..."
```

For Terraform OCI provider auth, also set:

```bash
export OCI_CLI_TENANCY="ocid1.tenancy.oc1..aaaa..."
export OCI_CLI_USER="ocid1.user.oc1..aaaa..."
export OCI_CLI_FINGERPRINT="aa:bb:..."
export OCI_CLI_KEY_FILE=~/.oci/key.pem
```

### 2. Get OCI IDs

- **Compartment OCID**: Console → Identity → Compartments → your compartment → OCID  
- **Subnet OCID**: Networking → Virtual Cloud Networks → VCN → Subnets → your **public** subnet (so the container instance can get a public IP)  
- **Tenancy namespace**: Profile (top-right) → Tenancy → copy **Object Storage Namespace** (used as OCIR namespace)

### 3. Terraform (create OCIR repo + optional container instance)

```bash
cd v2-ubuntu-base-container/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars: cloud_provider = "oci", oci_compartment_id, oci_subnet_id, oci_ocir_namespace, oci_region
terraform init
terraform plan   # review
terraform apply  # type yes when prompted
```

Note outputs: `oci_image_url`, `oci_container_instance_id`, and (if you created an instance) the instance’s **Public IP** in the OCI Console.

### 4. Build and push image to OCIR

Before the container instance can run the image, it must exist in OCIR.

**Create an Auth Token** (if you don’t use OCI CLI for Docker):  
Console → Profile → User Settings → Auth Tokens → Generate Token. Save the token; it won’t be shown again.

Then:

```bash
cd v2-ubuntu-base-container
export OCI_OCIR_NAMESPACE="axxxxxxxxxx"      # same as in tfvars
export OCI_REGION="ap-tokyo-1"
export OCI_AUTH_TOKEN="<paste-auth-token>"
export OCI_OCIR_USER="${OCI_OCIR_NAMESPACE}/your@email.com"   # or your OCI username
./oci-push.sh
```

If Terraform already created a container instance, it will pull the image on next boot (or restart the instance from the Console). If the image didn’t exist at apply time, either:

- Run `terraform apply` again after push (image URL is the same), or  
- Restart the container instance from the Console so it pulls the new image.

### 5. Open code-server

- OCI Console → Developer Services → **Container Instances** → select your instance.  
- Copy the **Public IP** (if the subnet is public).  
- In the browser: **http://&lt;public-ip&gt;** (code-server listens on port 80).

---

## Deploy on AWS

### 1. Credentials

```bash
aws configure
# or set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
```

### 2. Terraform (ECR + ECS cluster + task definition template)

```bash
cd v2-ubuntu-base-container/terraform
cp terraform.tfvars.example terraform.tfvars
# Edit: cloud_provider = "aws", aws_account_id, aws_region
terraform init
terraform plan
terraform apply
```

### 3. Build and push image to ECR

```bash
cd v2-ubuntu-base-container
export AWS_ACCOUNT_ID=123456789012
export AWS_REGION=ap-northeast-1
./aws-push.sh
```

### 4. Register ECS task revision (for launcher)

```bash
IMAGE=$(./aws-push.sh | tail -1)
./ecs-new-revision.sh "$IMAGE"
```

### 5. Run the launcher and start sessions

Set `CLUSTER` to the Terraform output `aws_ecs_cluster_name`, then run the launcher server. Use the launcher UI or `POST /api/launch` to start ECS tasks; use the returned URL to open code-server.

---

## Switching clouds

- Use a **different tfvars file** or **Terraform workspaces** to avoid mixing state:  
  `terraform workspace new oci` / `terraform workspace new aws`, then set variables per workspace.  
- Or use **separate directories** (e.g. `terraform/oci/` and `terraform/aws/`) with backend config per cloud.

---

## Files added for multi-cloud

| File | Purpose |
|------|--------|
| `terraform/versions.tf` | Terraform and provider version constraints |
| `terraform/variables.tf` | Inputs for AWS and OCI |
| `terraform/main.tf` | ECR/ECS (AWS) and OCIR/Container Instance (OCI) |
| `terraform/outputs.tf` | ECR URL, ECS cluster, OCIR/instance IDs, code-server URL hint |
| `terraform/providers.tf` | AWS and OCI provider config |
| `terraform/terraform.tfvars.example` | Example variables (copy to `terraform.tfvars`) |
| `oci-push.sh` | Build and push image to OCIR (counterpart to `aws-push.sh`) |
| `DEPLOY.md` | This deployment guide |
