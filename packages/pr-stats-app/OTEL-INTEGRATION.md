# OpenTelemetry Integration

This application now includes an **OpenTelemetry (OTel)** compliant timeline format alongside the native timeline representation.

## Overview

The OTel timeline follows the [OpenTelemetry CI/CD Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/cicd/) and represents PR lifecycle events as distributed traces with spans, attributes, events, and metrics.

## What's Included

### 1. OTel Types (`types-otel.ts`)

Defines the OTel-compliant data structures:

- **OTelSpan**: Represents a unit of work (build, review, commit)
- **OTelAttributes**: Semantic attributes following OTel conventions
- **OTelMetric**: Measurements like pipeline duration and build times
- **OTelPRTimeline**: Complete trace representation of a PR

### 2. OTel Transformer (`otel-transformer.ts`)

Transforms native timeline data into OTel format:

```typescript
import { transformToOTel } from './lib/otel-transformer';

const otelTimeline = transformToOTel(prStats);
```

### 3. Automatic Generation

The OTel timeline is automatically generated when fetching PR data and included in the `PullRequestStats` object as `otel_timeline`.

## Data Structure

### Root Span: PR Lifecycle

Represents the entire PR from creation to closure/merge.

**Attributes:**

- `cicd.pipeline.name`: PR pipeline name
- `cicd.pipeline.run.id`: PR number
- `cicd.pipeline.run.result`: success | failure | cancelled
- `vcs.repository.url.full`: GitHub repository URL
- `vcs.repository.ref.revision`: Head commit SHA
- `pr.number`, `pr.title`, `pr.author`, `pr.state`

### Child Spans: CI/CD Builds

Each build/job is represented as a child span.

**Attributes:**

- `cicd.pipeline.task.name`: Build/job name
- `cicd.pipeline.task.type`: build | test | deploy
- `cicd.build_system.name`: buildkite | github_actions
- `buildkite.build.id`, `buildkite.build.number`, `buildkite.pipeline.slug`

### Child Spans: Code Reviews

Each review is represented as a span.

**Attributes:**

- `pr.review.state`: approved | changes_requested | commented
- `pr.review.author`: Reviewer username

### Child Spans: Commits

Each commit push is represented as a span.

**Attributes:**

- `vcs.operation`: commits.added | commits.pushed
- `vcs.commit.count`: Number of commits in the push

## Metrics

The OTel timeline includes metrics following the semantic conventions:

### `cicd.pipeline.run.duration`

- **Type**: Histogram
- **Unit**: seconds
- **Description**: Duration of the entire PR pipeline from creation to closure

### `cicd.build.duration`

- **Type**: Histogram
- **Unit**: seconds
- **Description**: Build durations
- **Types**:
  - `build.type: wall_to_wall` - Actual elapsed time
  - `build.type: cumulative` - Sum of all parallel jobs

## Usage Examples

### Accessing the OTel Timeline

```typescript
const response = await fetch('/api/pr/elastic/kibana/12345');
const data = await response.json();

// Native timeline
console.log(data.data.timeline);

// OTel timeline
console.log(data.data.otel_timeline);
```

### Exporting to OTel Collector

```typescript
import { transformToOTel } from './lib/otel-transformer';

// Transform and send to OTel collector
const otelData = transformToOTel(prStats);

await fetch('http://otel-collector:4318/v1/traces', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(otelData),
});
```

### Analyzing with OTel Tools

The OTel timeline can be:

1. **Sent to Jaeger/Zipkin** for distributed tracing visualization
2. **Exported to Prometheus** for metric analysis
3. **Processed by custom collectors** for analytics
4. **Integrated with observability platforms** (DataDog, New Relic, etc.)

## Span Hierarchy

```
PR #12345: Feature Implementation (Root Span)
├── CI Build: kibana / pull request #1234 (Child Span)
│   ├── Job: lint (Build has parallelization)
│   ├── Job: test
│   └── Job: build
├── CI Build: kibana / pull request #1235 (Child Span)
│   └── Jobs...
├── Review: approved (Child Span)
├── Review: changes_requested (Child Span)
├── Commits: pushed (Child Span)
└── Commits: pushed (Child Span)
```

## Benefits

### 1. **Standardization**

- Industry-standard format for CI/CD observability
- Compatible with existing OTel tooling

### 2. **Interoperability**

- Can be ingested by any OTel-compatible system
- Unified observability across tools

### 3. **Advanced Analytics**

- Distributed tracing of PR workflows
- Correlation with other system traces
- Rich querying capabilities

### 4. **Vendor Agnostic**

- Not tied to specific observability platforms
- Freedom to choose your analytics stack

## Semantic Conventions Compliance

This implementation follows:

- [OTel CI/CD Metrics Conventions](https://opentelemetry.io/docs/specs/semconv/cicd/cicd-metrics/)
- [OTel Trace Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/general/trace/)
- [OTel Resource Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/resource/)

## Custom Attributes

In addition to standard OTel attributes, we include:

- `pr.*` - PR-specific attributes (number, title, author, state)
- `pr.review.*` - Review-specific attributes
- `buildkite.*` - Buildkite-specific attributes

These follow OTel naming conventions and can be filtered/grouped in observability tools.

## Future Enhancements

Potential additions:

- [ ] Add span links between related builds
- [ ] Include test result attributes
- [ ] Add deployment tracking spans
- [ ] Export directly to OTel collector
- [ ] Add sampling configuration
- [ ] Include baggage for context propagation
- [ ] Add resource attributes (team, service, environment)

## References

- [OpenTelemetry Specification](https://opentelemetry.io/docs/reference/specification/)
- [CI/CD Semantic Conventions](https://github.com/open-telemetry/semantic-conventions/tree/main/model/cicd)
- [OTel Trace API](https://opentelemetry.io/docs/reference/specification/trace/api/)
- [OTel Metrics API](https://opentelemetry.io/docs/reference/specification/metrics/api/)
