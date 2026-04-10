# Offline / Local LLM Architecture

## Overview

ContentNode supports two execution modes for AI workflow processing:

- **Online mode** — AI calls are made to cloud providers (Anthropic Claude, OpenAI). The workflow worker runs on ContentNode's cloud infrastructure (Railway).
- **Offline mode** — AI calls are made exclusively to a local language model (Ollama) running on the agency's own hardware. The workflow worker also runs on the agency's own hardware.

This document describes the offline architecture, how it works, and why it is secure for privacy-sensitive clients.

---

## How It Works

### Online Mode (standard)

```
Client Browser → ContentNode API (Railway) → Redis Queue (Railway)
                                                      ↓
                                             Cloud Worker (Railway)
                                                      ↓
                                        Anthropic / OpenAI (cloud AI)
                                                      ↓
                                          Results → Database (Railway)
```

All components run in the cloud. Client content passes through ContentNode's infrastructure and is sent to a third-party AI provider.

### Offline Mode (local)

```
Client Browser → ContentNode API (Railway) → Redis Queue (Railway)
                                                      ↓
                                          Local Worker (agency machine)
                                                      ↓
                                          Ollama (agency machine)
                                          Local LLM — never leaves machine
                                                      ↓
                                          Results → Database (Railway)
```

The critical difference: **client content never leaves the agency's machine.** The local worker pulls the job from the queue, processes it entirely on-premise using a locally running language model, and writes only the results back to the database.

---

## What Stays Local

When a workflow runs in offline mode, the following never leave the agency's hardware:

- The client's raw content (documents, transcripts, uploaded files)
- Any intermediate AI prompts constructed from that content
- The language model itself and its weights
- All inference computation

The only data that travels over the network:
- The job identifier (a UUID with no content)
- The final processed output written back to the database
- Workflow run status updates (pass/fail, token counts)

---

## What Travels Over the Network

The local worker maintains two outbound connections to ContentNode's cloud infrastructure:

1. **Redis (queue)** — The worker polls for new jobs. The job payload contains node configurations and references to content, not the content itself. File content is read from local storage or fetched via authenticated API calls scoped to that job.
2. **PostgreSQL (database)** — The worker writes results back after processing is complete.

Both connections use TLS encryption in transit. Credentials are stored in the worker's local environment configuration and never transmitted as plaintext.

---

## Security Properties

### Data isolation
Client content is processed entirely within the agency's network perimeter. No third-party AI provider — Anthropic, OpenAI, or any other — ever receives the client's data. This satisfies requirements for clients operating under strict data residency, NDA, or confidentiality obligations.

### No content in the queue
The Redis job queue carries only job metadata (run ID, workflow ID, agency ID). It does not carry document content or prompts. An attacker with access to the queue would see job identifiers only, not client data.

### Multi-tenant isolation
Each job is tagged with an `agencyId`. The worker enforces this at the database layer — all queries include the agency ID as a filter, enforced by Prisma middleware. A compromised worker for one agency cannot read or write another agency's data.

### Credential security
The local worker requires database and Redis credentials to operate. These are stored in a local `.env` file on the agency's machine, never committed to source control, and never transmitted to ContentNode's servers. The agency controls these credentials and can rotate them at any time.

### Ollama runs air-gapped
Ollama and the language model weights run as a local process with no outbound network access required. The model can be run fully air-gapped — disconnected from the internet entirely — and the worker will still function correctly for offline-mode workflows.

---

## Agency Requirements

To run the local worker, the agency needs:

- A machine (Mac, Linux, or Windows with WSL) running continuously while processing offline jobs
- [Ollama](https://ollama.ai) installed, with the desired model pulled (e.g. `ollama pull gemma3:12b`)
- The ContentNode worker software installed and configured with production database and Redis credentials
- Sufficient RAM for the chosen model (e.g. 16GB+ for a 12B parameter model)

---

## Roadmap

The current implementation requires the agency to run the worker on their own machine manually. Planned improvements include:

- **Admin-controlled worker configuration** — Agency administrators will be able to choose between cloud worker (online) and local worker (offline) from the ContentNode dashboard, per client
- **Self-hosted server option** — Agencies with a dedicated on-premise server or private cloud can run Ollama and the worker there instead of on a workstation, providing higher availability for offline workflows
- **Worker health monitoring** — The ContentNode dashboard will show whether the local worker is connected and processing jobs, so agencies can detect if it goes offline

---

## Enterprise & Fortune 100 Security Requirements

Agencies serving Fortune 100 clients or operating in regulated industries (financial services, healthcare, defense, legal) should be aware of the following additional requirements beyond the base offline architecture.

### Compliance Certifications

| Certification | What it covers | Status |
|---|---|---|
| SOC 2 Type II | Formal third-party audit of ContentNode's security controls, availability, and confidentiality practices | Roadmap |
| ISO 27001 | International standard for information security management | Roadmap |
| HIPAA (if applicable) | Required if processing protected health information | Requires signed BAA with ContentNode |
| GDPR / CCPA | Data residency and right-to-deletion requirements | Partially addressed by offline mode; full compliance requires DPA |

### Network Security

The base offline architecture routes worker-to-database traffic over the public internet using TLS. Enterprise deployments should replace this with:

- **Private tunnels** — WireGuard or IPSec VPN between the agency's local worker and ContentNode's database/Redis, eliminating exposure on the public internet entirely
- **IP allowlisting** — Database and Redis access restricted to the agency's known static IP addresses only
- **Private link / VPC peering** — For agencies running their own cloud infrastructure, direct private network peering with ContentNode's VPC (available on request)

### Encryption at Rest

ContentNode currently encrypts data in transit (TLS). For enterprise requirements:

- **Database encryption** — PostgreSQL transparent data encryption (TDE) for all stored content
- **Field-level encryption** — Sensitive fields (client content, AI outputs) encrypted at the application layer before writing to the database, so database administrators cannot read client data
- **Key management** — Agency-controlled encryption keys via AWS KMS, HashiCorp Vault, or equivalent, so ContentNode staff have zero access to decrypted client data

### Identity & Access Management

- **SSO / SAML integration** — Agency staff authenticate via the agency's existing identity provider (Okta, Azure AD, etc.) rather than ContentNode's own auth
- **Role-based access control** — Already implemented; enterprise deployments can request custom role definitions
- **MFA enforcement** — Mandatory multi-factor authentication for all agency administrator accounts
- **Session controls** — Configurable session timeouts and concurrent session limits

### Audit & Compliance Logging

ContentNode maintains an append-only audit log of all data access and workflow execution events. For enterprise requirements:

- **Log export** — Audit logs exportable to the agency's SIEM (Splunk, Datadog, etc.) in real time
- **Tamper-evident logging** — Cryptographic chaining of log entries so deletion or modification is detectable
- **Retention controls** — Configurable log retention periods to meet regulatory requirements (e.g. 7 years for financial services)

### Data Handling Agreements

Architecture alone is not sufficient for Fortune 100 procurement. Legal agreements required include:

- **Data Processing Agreement (DPA)** — Formal contract defining how ContentNode handles client data, required for GDPR compliance and standard in enterprise procurement
- **Business Associate Agreement (BAA)** — Required if any workflow touches protected health information (HIPAA)
- **Non-Disclosure Agreement (NDA)** — Standard for enterprise engagements; available on request
- **Penetration testing report** — Many Fortune 100 security teams require evidence of third-party penetration testing before approving a vendor

### Incident Response

Enterprise clients typically require:

- A documented incident response plan
- Defined SLAs for breach notification (GDPR requires 72 hours)
- A named security contact at ContentNode
- Regular security review cadence (quarterly or annually)

---

## Summary

Offline mode is designed for agencies whose clients have strict data privacy requirements. By running the AI worker and language model on the agency's own hardware, client content never leaves the agency's control. ContentNode's cloud infrastructure serves only as a coordination layer — routing jobs and storing results — while all sensitive computation happens on-premise.

For Fortune 100 and regulated industry clients, the offline architecture provides the technical foundation. Full enterprise readiness requires additional work across network security, encryption at rest, identity management, legal agreements, and compliance certifications. ContentNode's roadmap includes SOC 2 Type II certification and the tooling needed to support enterprise procurement requirements.
