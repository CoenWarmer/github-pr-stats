# Deployment Guide

## OpenTelemetry Collector + Elasticsearch Setup

This guide covers deploying the CI/CD OpenTelemetry Pipeline with the OpenTelemetry Collector forwarding logs to Elasticsearch.

## Architecture

```
GitHub/Buildkite → Your App → OTel Collector → Elasticsearch → Kibana
                     (port 3000)  (port 4318)    (port 9200)   (port 5601)
```

## Quick Start (Local Development)

### 1. Clone and Setup

```bash
cd packages/cicd-otel-pipeline
cp env.template .env
# Edit .env with your credentials
```

### 2. Start Everything with Docker Compose

```bash
docker-compose up -d
```

This starts:

- **OTel Collector** (ports 4317, 4318)
- **Elasticsearch** (port 9200)
- **Kibana** (port 5601)
- **Your CI/CD Pipeline** (port 3000)

### 3. Verify Services

```bash
# Check OTel Collector health
curl http://localhost:13133

# Check Elasticsearch
curl http://localhost:9200

# Check your app
curl http://localhost:3000/health
```

### 4. View Logs in Kibana

1. Open http://localhost:5601
2. Go to **Management** → **Stack Management** → **Index Management**
3. You should see `cicd-events-*` indices
4. Go to **Analytics** → **Discover** to view logs

### 5. Send a Test Webhook

```bash
# Test GitHub PR webhook
curl -X POST http://localhost:3000/webhook/github \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: pull_request" \
  -d '{
    "action": "opened",
    "number": 123,
    "pull_request": {
      "id": 1,
      "title": "Test PR",
      "state": "open",
      "html_url": "https://github.com/owner/repo/pull/123",
      "user": {"login": "testuser"},
      "base": {"ref": "main"},
      "head": {"ref": "feature-branch"},
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    },
    "repository": {
      "full_name": "owner/repo"
    }
  }'
```

Check Elasticsearch for the event:

```bash
curl http://localhost:9200/cicd-events-*/_search?pretty
```

---

## Production Deployment

### Option A: Kubernetes

**1. Create ConfigMap for OTel Collector:**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: otel-collector-config
data:
  config.yaml: |
    # Paste contents from otel-collector-config.yaml
```

**2. Deploy OTel Collector:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: otel-collector
spec:
  replicas: 2
  selector:
    matchLabels:
      app: otel-collector
  template:
    metadata:
      labels:
        app: otel-collector
    spec:
      containers:
        - name: otel-collector
          image: otel/opentelemetry-collector-contrib:latest
          args: ['--config=/etc/otel-config.yaml']
          ports:
            - containerPort: 4318
              name: otlp-http
            - containerPort: 13133
              name: health
          volumeMounts:
            - name: config
              mountPath: /etc/otel-config.yaml
              subPath: config.yaml
          env:
            - name: ELASTICSEARCH_ENDPOINT
              valueFrom:
                secretKeyRef:
                  name: elasticsearch-secret
                  key: endpoint
            - name: ELASTICSEARCH_USERNAME
              valueFrom:
                secretKeyRef:
                  name: elasticsearch-secret
                  key: username
            - name: ELASTICSEARCH_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: elasticsearch-secret
                  key: password
      volumes:
        - name: config
          configMap:
            name: otel-collector-config
---
apiVersion: v1
kind: Service
metadata:
  name: otel-collector
spec:
  selector:
    app: otel-collector
  ports:
    - port: 4318
      targetPort: 4318
      name: otlp-http
```

**3. Deploy Your App:**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cicd-pipeline
spec:
  replicas: 2
  selector:
    matchLabels:
      app: cicd-pipeline
  template:
    metadata:
      labels:
        app: cicd-pipeline
    spec:
      containers:
        - name: cicd-pipeline
          image: your-registry/cicd-otel-pipeline:latest
          ports:
            - containerPort: 3000
          env:
            - name: OTEL_EXPORTER_OTLP_ENDPOINT
              value: 'https://your-cluster.ingest.elastic.cloud:443'
            - name: OTEL_EXPORTER_OTLP_HEADERS
              valueFrom:
                secretKeyRef:
                  name: elastic-apm-secret
                  key: otlp-headers
            - name: OTEL_RESOURCE_ATTRIBUTES
              value: 'service.name=cicd-otel-pipeline,service.version=1.0.0,deployment.environment=production'
            - name: GITHUB_TOKEN
              valueFrom:
                secretKeyRef:
                  name: github-secret
                  key: token
```

### Option B: Docker Swarm

```bash
# Create secrets
echo "your-token" | docker secret create github_token -
echo "your-secret" | docker secret create github_webhook_secret -

# Deploy stack
docker stack deploy -c docker-compose.prod.yml cicd-pipeline
```

### Option C: VM/Bare Metal

**1. Install OTel Collector:**

```bash
# Download
wget https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v0.91.0/otelcol-contrib_0.91.0_linux_amd64.tar.gz

# Extract
tar -xvf otelcol-contrib_0.91.0_linux_amd64.tar.gz

# Move config
sudo cp otel-collector-config.yaml /etc/otel-collector-config.yaml

# Create systemd service
sudo tee /etc/systemd/system/otel-collector.service << EOF
[Unit]
Description=OpenTelemetry Collector
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/otelcol-contrib --config=/etc/otel-collector-config.yaml
Restart=always
Environment="ELASTICSEARCH_ENDPOINT=http://localhost:9200"
Environment="ELASTICSEARCH_USERNAME=elastic"
Environment="ELASTICSEARCH_PASSWORD=changeme"

[Install]
WantedBy=multi-user.target
EOF

# Start service
sudo systemctl daemon-reload
sudo systemctl enable otel-collector
sudo systemctl start otel-collector
```

**2. Install and run your app:**

```bash
# Build
yarn build

# Start with PM2
pm2 start dist/index.js --name cicd-pipeline
```

---

## Elasticsearch Configuration

### Self-Managed Elasticsearch

Update `otel-collector-config.yaml`:

```yaml
exporters:
  elasticsearch:
    endpoints:
      - http://your-elasticsearch-host:9200
```

### Elastic Cloud

```yaml
exporters:
  elasticsearch:
    endpoints:
      - https://your-deployment.es.region.cloud.es.io:443
    auth:
      authenticator: api_key
    cloudid: 'deployment-name:base64encodedcloudid'
```

Add to `extensions`:

```yaml
extensions:
  api_key:
    client_auth:
      api_key: 'your-api-key'
```

### Elasticsearch Serverless

```yaml
exporters:
  elasticsearch:
    endpoints:
      - https://your-serverless.es.region.aws.found.io:443
    auth:
      authenticator: api_key
```

---

## Monitoring & Troubleshooting

### OTel Collector Metrics

```bash
# Prometheus metrics
curl http://localhost:8888/metrics

# zpages for diagnostics
open http://localhost:55679/debug/tracez
```

### Check Elasticsearch Indices

```bash
# List indices
curl http://localhost:9200/_cat/indices/cicd-events-*?v

# Count documents
curl http://localhost:9200/cicd-events-*/_count

# Sample documents
curl http://localhost:9200/cicd-events-*/_search?size=5&pretty
```

### Common Issues

**Logs not appearing in Elasticsearch:**

```bash
# Check OTel Collector logs
docker logs otel-collector

# Verify connectivity
docker exec otel-collector curl http://elasticsearch:9200

# Check receiver is working
curl http://localhost:4318/v1/logs -X POST -d '{}'
```

**High memory usage:**

- Adjust `memory_limiter` in config
- Reduce `batch.send_batch_size`
- Increase `batch.timeout`

**Connection refused:**

```bash
# Check if services are running
docker ps

# Check network connectivity
docker network inspect otel-network
```

---

## Scaling

### Horizontal Scaling

Run multiple instances behind a load balancer:

```yaml
# docker-compose.prod.yml
services:
  cicd-pipeline:
    deploy:
      replicas: 3

  otel-collector:
    deploy:
      replicas: 2
```

### Vertical Scaling

Adjust OTel Collector resources:

```yaml
exporters:
  elasticsearch:
    sending_queue:
      queue_size: 5000 # Increase queue
      num_consumers: 20 # More parallel consumers
```

---

## Security Best Practices

1. **Use TLS/SSL:**

```yaml
exporters:
  elasticsearch:
    endpoints:
      - https://elasticsearch:9200
    tls:
      insecure_skip_verify: false
      ca_file: /etc/ssl/certs/ca.crt
```

2. **Rotate API Keys:**

```bash
# Use Kubernetes secrets or vault
kubectl create secret generic es-creds \
  --from-literal=api-key=new-key
```

3. **Network Policies:**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: otel-collector
spec:
  podSelector:
    matchLabels:
      app: otel-collector
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: cicd-pipeline
```

---

## Backup & Recovery

### Elasticsearch Snapshots

```bash
# Configure snapshot repository
curl -X PUT "localhost:9200/_snapshot/backup" -H 'Content-Type: application/json' -d'
{
  "type": "fs",
  "settings": {
    "location": "/mnt/backups"
  }
}'

# Create snapshot
curl -X PUT "localhost:9200/_snapshot/backup/snapshot_1?wait_for_completion=true"
```

---

## Cost Optimization

1. **Index Lifecycle Management (ILM):**
   - Hot: 7 days
   - Warm: 30 days
   - Cold: 90 days
   - Delete: 365 days

2. **Data Stream with ILM:**

```bash
curl -X PUT "localhost:9200/_ilm/policy/cicd-events-policy" -H 'Content-Type: application/json' -d'
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "7d"
          }
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}'
```

3. **Sampling:**

```yaml
processors:
  probabilistic_sampler:
    sampling_percentage: 10 # Sample 10% of logs
```
