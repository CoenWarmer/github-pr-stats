import { Client } from '@elastic/elasticsearch';
import { PullRequestStats } from '../types';
import { logger } from '../logger';

export class ElasticsearchService {
  private client: Client | null = null;
  private indexName: string;
  private enabled: boolean;

  constructor() {
    // Check if Elasticsearch is configured
    const esNode = process.env.ES_NODE;
    const esApiKey = process.env.ES_API_KEY;
    this.indexName = process.env.ES_INDEX_NAME || 'github-pr-stats';

    this.enabled = !!(esNode && esApiKey);

    if (this.enabled && esNode && esApiKey) {
      try {
        this.client = new Client({
          node: esNode,
          auth: {
            apiKey: esApiKey,
          },
          // Optional: configure request timeout
          requestTimeout: 30000,
          // Optional: retry on connection failure
          maxRetries: 3,
        });

        logger.info('Elasticsearch service initialized', {
          node: esNode,
          index: this.indexName,
        });
      } catch (error) {
        logger.error('Failed to initialize Elasticsearch client', {
          error: error instanceof Error ? error.message : error,
        });
        this.enabled = false;
      }
    } else {
      logger.debug('Elasticsearch service is disabled (missing configuration)');
    }
  }

  /**
   * Check if Elasticsearch service is enabled and ready
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  /**
   * Test connection to Elasticsearch
   */
  async testConnection(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      const response = await this.client.ping();
      logger.info('Elasticsearch connection successful');
      return response;
    } catch (error) {
      logger.error('Elasticsearch connection failed', {
        error: error instanceof Error ? error.message : error,
      });
      return false;
    }
  }

  /**
   * Ensure the index exists with proper mappings
   */
  async ensureIndex(): Promise<void> {
    if (!this.client) {
      throw new Error('Elasticsearch client is not initialized');
    }

    try {
      const exists = await this.client.indices.exists({
        index: this.indexName,
      });

      if (!exists) {
        logger.info(`Creating Elasticsearch index: ${this.indexName}`);

        await this.client.indices.create({
          index: this.indexName,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              title: { type: 'text' },
              url: { type: 'keyword' },
              created_at: { type: 'date' },
              updated_at: { type: 'date' },
              merged_at: { type: 'date' },
              closed_at: { type: 'date' },
              author: { type: 'keyword' },
              author_teams: { type: 'keyword' },
              state: { type: 'keyword' },
              draft: { type: 'boolean' },

              // PR size metrics
              commits: { type: 'integer' },
              additions: { type: 'integer' },
              deletions: { type: 'integer' },
              changed_files: { type: 'integer' },

              // Codeowners
              'codeowners.teams': { type: 'keyword' },
              'codeowners.individuals': { type: 'keyword' },

              // Build statistics
              'build_stats.total_builds': { type: 'integer' },
              'build_stats.completed_builds': { type: 'integer' },
              'build_stats.failed_builds': { type: 'integer' },
              'build_stats.successful_builds': { type: 'integer' },
              'build_stats.cancelled_builds': { type: 'integer' },
              'build_stats.total_build_time_ms': { type: 'long' },
              'build_stats.wall_to_wall_build_time_ms': { type: 'long' },
              'build_stats.cumulative_build_time_ms': { type: 'long' },

              // Metrics
              'metrics.turnaround_time_hours': { type: 'float' },
              'metrics.complexity': { type: 'float' },
              'metrics.delivery_friction': { type: 'float' },
              'metrics.total_team_review_time_ms': { type: 'long' },
              'metrics.run_start_time': { type: 'date' },
              'metrics.run_end_time': { type: 'date' },

              // Reviews
              'reviews.comments': { type: 'integer' },
              'reviews.back_and_forth_count': { type: 'integer' },
              'reviews.requested_teams': { type: 'keyword' },
              'reviews.review_comments': { type: 'integer' },

              // Timeline (stored as nested objects)
              timeline: { type: 'object', enabled: false },

              // OTel timeline (stored as nested objects)
              otel_timeline: { type: 'object', enabled: false },

              // Linked issues (stored as nested objects)
              linked_issues: { type: 'object', enabled: false },

              // Metadata
              indexed_at: { type: 'date' },
              repo_owner: { type: 'keyword' },
              repo_name: { type: 'keyword' },
            },
          },
        });

        logger.info(`Elasticsearch index created: ${this.indexName}`);
      }
    } catch (error) {
      logger.error('Error ensuring Elasticsearch index', {
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Index a PR stats document
   */
  async indexPRStats(prStats: PullRequestStats): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      logger.debug('Elasticsearch indexing skipped (service disabled)');
      return;
    }

    try {
      // Ensure index exists
      await this.ensureIndex();

      // Extract repo owner and name from URL
      const urlMatch = prStats.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
      const repoOwner = urlMatch?.[1] || 'unknown';
      const repoName = urlMatch?.[2] || 'unknown';

      // Generate document ID
      const docId = `${repoOwner}-${repoName}-${prStats.id}`;

      // Prepare document for indexing (without _id metadata field)
      const document = {
        ...prStats,
        indexed_at: new Date().toISOString(),
        repo_owner: repoOwner,
        repo_name: repoName,
      };

      // Index the document (upsert)
      const response = await this.client.index({
        index: this.indexName,
        id: docId,
        document,
        refresh: false, // Don't wait for refresh for better performance
      });

      logger.info('PR stats indexed to Elasticsearch', {
        id: docId,
        result: response.result,
        index: this.indexName,
      });
    } catch (error) {
      logger.error('Error indexing PR stats to Elasticsearch', {
        prId: prStats.id,
        error: error instanceof Error ? error.message : error,
      });
      // Don't throw - we don't want to fail the request if ES indexing fails
    }
  }

  /**
   * Bulk index multiple PR stats documents
   */
  async bulkIndexPRStats(prStatsList: PullRequestStats[]): Promise<void> {
    if (!this.isEnabled() || !this.client) {
      logger.debug('Elasticsearch bulk indexing skipped (service disabled)');
      return;
    }

    try {
      // Ensure index exists
      await this.ensureIndex();

      const operations = prStatsList.flatMap(prStats => {
        const urlMatch = prStats.url.match(
          /github\.com\/([^/]+)\/([^/]+)\/pull/
        );
        const repoOwner = urlMatch?.[1] || 'unknown';
        const repoName = urlMatch?.[2] || 'unknown';
        const docId = `${repoOwner}-${repoName}-${prStats.id}`;

        return [
          { index: { _index: this.indexName, _id: docId } },
          {
            ...prStats,
            indexed_at: new Date().toISOString(),
            repo_owner: repoOwner,
            repo_name: repoName,
          },
        ];
      });

      const response = await this.client.bulk({
        operations,
        refresh: false,
      });

      if (response.errors) {
        logger.warn('Some documents failed to index', {
          errors: response.items
            ?.filter(item => item.index?.error)
            .map(item => item.index?.error),
        });
      } else {
        logger.info('PR stats bulk indexed to Elasticsearch', {
          count: prStatsList.length,
          index: this.indexName,
        });
      }
    } catch (error) {
      logger.error('Error bulk indexing PR stats to Elasticsearch', {
        count: prStatsList.length,
        error: error instanceof Error ? error.message : error,
      });
      // Don't throw - we don't want to fail the request if ES indexing fails
    }
  }

  /**
   * Search for PR stats
   */
  async searchPRStats(query: {
    author?: string;
    repo_owner?: string;
    repo_name?: string;
    state?: string;
    from?: Date;
    to?: Date;
    size?: number;
  }): Promise<PullRequestStats[]> {
    if (!this.isEnabled() || !this.client) {
      throw new Error('Elasticsearch service is not enabled');
    }

    try {
      // Build query filters
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const must: any[] = [];

      if (query.author) {
        must.push({ term: { author: query.author } });
      }
      if (query.repo_owner) {
        must.push({ term: { repo_owner: query.repo_owner } });
      }
      if (query.repo_name) {
        must.push({ term: { repo_name: query.repo_name } });
      }
      if (query.state) {
        must.push({ term: { state: query.state } });
      }
      if (query.from || query.to) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const range: any = {};
        if (query.from) range.gte = query.from.toISOString();
        if (query.to) range.lte = query.to.toISOString();
        must.push({ range: { created_at: range } });
      }

      const response = await this.client.search({
        index: this.indexName,
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
          },
        },
        size: query.size || 100,
        sort: [{ created_at: 'desc' }],
      });

      return response.hits.hits.map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (hit: any) => hit._source as PullRequestStats
      );
    } catch (error) {
      logger.error('Error searching PR stats in Elasticsearch', {
        query,
        error: error instanceof Error ? error.message : error,
      });
      throw error;
    }
  }

  /**
   * Close the Elasticsearch client
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      logger.info('Elasticsearch client closed');
    }
  }
}

// Export singleton instance
export const elasticsearchService = new ElasticsearchService();
