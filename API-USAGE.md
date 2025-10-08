# API Usage Guide

## Unified `/api/pr/` Endpoint

The `/api/pr/` endpoint now supports both regular JSON responses and Server-Sent Events (SSE) streaming for real-time progress updates.

### Endpoints

#### GET `/api/pr/[owner]/[repo]/[prNumber]`

Fetch Pull Request statistics and timeline data.

**Query Parameters:**

- `force=true` - Bypass cache and fetch fresh data
- `stream=true` - Enable SSE streaming with progress updates

**Response Formats:**

1. **Regular JSON** (default):

```json
{
  "data": {
    "id": 222177,
    "title": "[APM] Remove labs",
    "state": "merged",
    "metrics": {
      "complexity": 4.5,
      "delivery_friction": 45,
      "total_team_review_time_ms": 3600000
    },
    "build_stats": {
      "total_builds": 10,
      "completed_builds": 9,
      "failed_builds": 1,
      "successful_builds": 8,
      "total_build_time_ms": 1800000
    },
    ...
  },
  "cached": false,
  "timestamp": 1696000000000
}
```

2. **SSE Streaming** (with `?stream=true`):

```
data: {"step":"Starting data collection","current":0,"total":100,"timestamp":1696000000000}

data: {"step":"Fetching PR data","current":5,"total":100,"timestamp":1696000001000}

data: {"step":"Fetching related data","current":10,"total":100,"timestamp":1696000002000}

...

data: {"complete":true,"data":{...prStats...}}
```

### Usage Examples

#### Browser (JavaScript)

**Regular JSON:**

```javascript
const response = await fetch('/api/pr/elastic/kibana/222177');
const { data, cached } = await response.json();
console.log('PR Data:', data);
console.log('From cache:', cached);
```

**SSE Streaming:**

```javascript
const eventSource = new EventSource(
  '/api/pr/elastic/kibana/222177?stream=true'
);

eventSource.onmessage = event => {
  const data = JSON.parse(event.data);

  if (data.error) {
    console.error('Error:', data.error);
    eventSource.close();
    return;
  }

  if (data.complete && data.data) {
    console.log('Complete! PR Data:', data.data);
    eventSource.close();
  } else if (data.step) {
    console.log(`Progress: ${data.current}% - ${data.step}`);
  }
};

eventSource.onerror = error => {
  console.error('Connection error:', error);
  eventSource.close();
};
```

#### cURL

**Regular JSON:**

```bash
# Get cached data (if available)
curl http://localhost:3000/api/pr/elastic/kibana/222177 | jq '.'

# Force refresh
curl http://localhost:3000/api/pr/elastic/kibana/222177?force=true | jq '.'
```

**SSE Streaming:**

```bash
# View raw SSE stream
curl -N http://localhost:3000/api/pr/elastic/kibana/222177?stream=true

# Extract just the JSON data
curl -N http://localhost:3000/api/pr/elastic/kibana/222177?stream=true \
  | grep "^data: " \
  | sed 's/^data: //'

# Pretty print JSON
curl -N http://localhost:3000/api/pr/elastic/kibana/222177?stream=true \
  | grep "^data: " \
  | sed 's/^data: //' \
  | jq '.'

# Monitor progress with formatted output
curl -N http://localhost:3000/api/pr/elastic/kibana/222177?stream=true \
  | while IFS= read -r line; do
      echo "$line" | sed 's/^data: //' | jq -r '
        if .step then "\(.current)%: \(.step)"
        elif .complete then "✓ Complete!"
        elif .error then "✗ Error: \(.error)"
        else empty
        end'
    done

# Force refresh with streaming
curl -N http://localhost:3000/api/pr/elastic/kibana/222177?stream=true&force=true \
  | grep "^data: " \
  | sed 's/^data: //' \
  | jq '.'
```

#### Python

**Regular JSON:**

```python
import requests

response = requests.get('http://localhost:3000/api/pr/elastic/kibana/222177')
data = response.json()
print(f"PR: {data['data']['title']}")
print(f"Cached: {data['cached']}")
```

**SSE Streaming:**

```python
import requests
import json

url = 'http://localhost:3000/api/pr/elastic/kibana/222177?stream=true'
response = requests.get(url, stream=True)

for line in response.iter_lines():
    if line:
        line = line.decode('utf-8')
        if line.startswith('data: '):
            data = json.loads(line[6:])  # Skip "data: " prefix

            if data.get('error'):
                print(f"Error: {data['error']}")
                break
            elif data.get('complete'):
                print("Complete!")
                pr_data = data.get('data')
                if pr_data:
                    print(f"PR: {pr_data['title']}")
                break
            elif data.get('step'):
                print(f"{data['current']}%: {data['step']}")
```

### Cache Management

#### DELETE `/api/pr/[owner]/[repo]/[prNumber]`

Clear cached data for a specific PR or all PRs.

**Query Parameters:**

- `all=true` - Clear all cached PRs (omit to clear specific PR)

**Examples:**

```bash
# Clear cache for specific PR
curl -X DELETE http://localhost:3000/api/pr/elastic/kibana/222177

# Clear all cache
curl -X DELETE http://localhost:3000/api/pr/elastic/kibana/222177?all=true
```

#### GET `/api/pr/[owner]/[repo]/[prNumber]/stats`

Get cache statistics.

```bash
curl http://localhost:3000/api/pr/elastic/kibana/222177/stats | jq '.'
```

**Response:**

```json
{
  "totalFiles": 42,
  "totalSize": 15728640,
  "oldestFile": "elastic-kibana-220000.json",
  "newestFile": "elastic-kibana-222177.json"
}
```

## Migration Notes

The old `/api/pr-progress/` endpoint has been removed. All functionality is now unified in `/api/pr/` with the `?stream=true` parameter.

**Before:**

```javascript
// Old: Separate endpoints
const eventSource = new EventSource('/api/pr-progress/elastic/kibana/222177');
// ... wait for progress ...
const response = await fetch('/api/pr/elastic/kibana/222177');
```

**After:**

```javascript
// New: Single unified endpoint
const eventSource = new EventSource(
  '/api/pr/elastic/kibana/222177?stream=true'
);
// Progress updates AND final data in one stream
```

## Benefits

1. **Single Source of Truth**: One endpoint handles both streaming and non-streaming requests
2. **No Duplicate API Calls**: Streaming mode returns the final data, eliminating the need for a second fetch
3. **Simpler Architecture**: Removed redundant `/api/pr-progress/` endpoint
4. **curl-Friendly**: SSE format works seamlessly with standard command-line tools
5. **Consistent Caching**: Data collected during streaming is automatically cached
