/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import type { Config } from '../../../config/config.js';
import type { ContentGeneratorConfig } from '../../contentGenerator.js';
import { GitHubCopilotAuthManager } from './githubCopilotAuthManager.js';
import { DEFAULT_TIMEOUT, DEFAULT_MAX_RETRIES } from '../constants.js';
import type { OpenAICompatibleProvider } from './types.js';

export class GitHubCopilotOpenAICompatibleProvider
  implements OpenAICompatibleProvider
{
  private readonly COPILOT_VERSION = '0.26.7';
  private readonly EDITOR_PLUGIN_VERSION = `copilot-chat/${this.COPILOT_VERSION}`;
  private readonly API_VERSION = '2025-04-01';

  private authManager: GitHubCopilotAuthManager;
  private accountType: string = 'individual'; // Default to individual
  private baseUrl: string;
  private initPromise: Promise<void> | null = null;

  constructor(
    private contentGeneratorConfig: ContentGeneratorConfig,
    _cliConfig: Config, // Prefix with underscore to indicate unused
  ) {
    // Use singleton auth manager to prevent duplicate authentications
    this.authManager = GitHubCopilotAuthManager.getInstance(undefined, false); // Use verbose=false for cleaner output

    // Determine base URL based on account type
    this.baseUrl =
      this.accountType === 'individual'
        ? 'https://api.githubcopilot.com'
        : `https://api.${this.accountType}.githubcopilot.com`;

    // Start initialization immediately but don't block constructor
    this.initPromise = this.authManager.initialize().catch((error) => {
      console.error(
        'Failed to initialize GitHub Copilot authentication:',
        error,
      );
      throw error;
    });
  }

  static isGitHubCopilotProvider(
    contentGeneratorConfig: ContentGeneratorConfig,
  ): boolean {
    // Check for authType first (most reliable indicator)
    if (contentGeneratorConfig.authType === 'github-copilot') {
      return true;
    }

    // Fallback: check baseURL for direct API usage
    const baseURL = contentGeneratorConfig.baseUrl || '';
    return baseURL.includes('githubcopilot.com');
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null; // Only initialize once
    }
  }

  buildHeaders(): Record<string, string | undefined> {
    return {
      'User-Agent': `GitHubCopilotChat/${this.COPILOT_VERSION}`, // Match original implementation
      'copilot-integration-id': 'vscode-chat',
      'editor-version': 'vscode/1.95.0', // Use lowercase like the working implementation
      'editor-plugin-version': this.EDITOR_PLUGIN_VERSION,
      'openai-intent': 'conversation-panel',
      'x-github-api-version': this.API_VERSION,
      'x-vscode-user-agent-library-version': 'electron-fetch',
      'X-Initiator': 'user',
    };
  }

  buildClient(): OpenAI {
    const { timeout = DEFAULT_TIMEOUT, maxRetries = DEFAULT_MAX_RETRIES } =
      this.contentGeneratorConfig;

    const defaultHeaders = this.buildHeaders();

    // Create a custom OpenAI client that handles GitHub Copilot authentication
    // We override the fetch function to inject the GitHub Copilot token
    const client = new OpenAI({
      apiKey: 'dummy-key', // Will be overridden by auth token
      baseURL: this.baseUrl, // GitHub Copilot API doesn't use /v1 path
      timeout,
      maxRetries,
      defaultHeaders,
      fetch: async (url: RequestInfo | URL, init?: RequestInit) => {
        // Ensure authentication is initialized
        await this.ensureInitialized();

        // Get the GitHub Copilot token
        const copilotToken = await this.authManager.getCopilotToken();

        // Get all the GitHub Copilot-specific headers
        const copilotHeaders = this.buildHeaders();

        // Inject the authorization header and merge with existing headers
        const enhancedInit: RequestInit = {
          ...init,
          headers: {
            ...copilotHeaders, // Include all GitHub Copilot headers
            ...init?.headers, // Preserve any existing headers
            Authorization: `Bearer ${copilotToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'user-agent': `GitHubCopilotChat/${this.COPILOT_VERSION}`, // Match original exactly
            'x-request-id': randomUUID(),
          },
        };

        // Use the native fetch
        return fetch(url, enhancedInit);
      },
    });

    return client;
  }

  buildRequest(
    request: OpenAI.Chat.ChatCompletionCreateParams,
    _userPromptId: string,
  ): OpenAI.Chat.ChatCompletionCreateParams {
    // For GitHub Copilot, we don't need special request modifications here
    // The authentication needs to be handled at the HTTP client level
    return {
      ...request,
      // Preserve all original parameters including sampling params
    };
  }

  /**
   * Get the Copilot token for external use
   */
  async getCopilotToken(): Promise<string> {
    await this.ensureInitialized();
    return this.authManager.getCopilotToken();
  }

  /**
   * Get the authentication headers for GitHub Copilot API calls
   */
  async getAuthHeaders(): Promise<Record<string, string>> {
    await this.ensureInitialized();
    const copilotToken = await this.authManager.getCopilotToken();
    const requestId = randomUUID();

    return {
      ...this.buildHeaders(),
      Authorization: `Bearer ${copilotToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-request-id': requestId,
    };
  }

  /**
   * Get the base URL for GitHub Copilot API
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.authManager.destroy();
  }
}
