/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token: string;
}

interface CopilotTokenResponse {
  expires_at: number;
  refresh_in: number;
  token: string;
}

interface GitHubUser {
  login: string;
}

export class GitHubCopilotAuthManager {
  // Singleton instance
  private static instance: GitHubCopilotAuthManager | null = null;

  private readonly GITHUB_CLIENT_ID = 'Iv1.b507a08c87ecfe98';
  private readonly GITHUB_API_BASE_URL = 'https://api.github.com';
  private readonly GITHUB_BASE_URL = 'https://github.com';
  private readonly APP_DIR = path.join(
    os.homedir(),
    '.local',
    'share',
    'gemini-cli',
  );
  private readonly GITHUB_TOKEN_PATH = path.join(this.APP_DIR, 'github_token');

  private githubToken: string | null = null;
  private copilotToken: string | null = null;
  private copilotTokenExpiresAt: number | null = null;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private verbose: boolean;
  private pollingCancelled: boolean = false;
  private isInitialized: boolean = false;
  private initializePromise: Promise<void> | null = null;

  /**
   * Get the singleton instance of GitHubCopilotAuthManager
   */
  static getInstance(
    providedGithubToken?: string,
    verbose: boolean = false,
  ): GitHubCopilotAuthManager {
    if (!GitHubCopilotAuthManager.instance) {
      GitHubCopilotAuthManager.instance = new GitHubCopilotAuthManager(
        providedGithubToken,
        verbose,
      );
    }
    return GitHubCopilotAuthManager.instance;
  }

  constructor(
    private providedGithubToken?: string,
    verbose: boolean = true,
  ) {
    this.verbose = verbose;
    if (this.verbose) {
      console.log('🔧 DEBUG: GitHubCopilotAuthManager constructor called');
      console.log(
        '🔧 DEBUG: providedGithubToken:',
        providedGithubToken ? '[PROVIDED]' : '[NOT_PROVIDED]',
      );
      console.log('🔧 DEBUG: APP_DIR:', this.APP_DIR);
      console.log('🔧 DEBUG: GITHUB_TOKEN_PATH:', this.GITHUB_TOKEN_PATH);
      console.log('🔧 DEBUG: Node.js version:', process.version);
      console.log('🔧 DEBUG: Platform:', process.platform);
    }
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  async initialize(): Promise<void> {
    // If already initialized, return immediately
    if (this.isInitialized) {
      if (this.verbose) {
        console.log('🔧 DEBUG: Already initialized, skipping');
      }
      return;
    }

    // If initialization is in progress, wait for it
    if (this.initializePromise) {
      if (this.verbose) {
        console.log('🔧 DEBUG: Initialization in progress, waiting...');
      }
      return this.initializePromise;
    }

    // Start new initialization
    this.initializePromise = this.doInitialize();

    try {
      await this.initializePromise;
      this.isInitialized = true;
    } finally {
      this.initializePromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    console.log('🔐 Initializing GitHub Copilot authentication...');
    if (this.verbose) {
      console.log('🔧 DEBUG: Starting initialize() method');

      // Test network connectivity
      console.log('🔧 DEBUG: Testing network connectivity...');
      try {
        const testResponse = await fetch('https://api.github.com', {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000),
        });
        console.log(
          '🔧 DEBUG: GitHub API connectivity test:',
          testResponse.status,
        );
      } catch (error) {
        console.log(
          '🔧 DEBUG: Network connectivity test failed:',
          error instanceof Error ? error.message : error,
        );
      }
    }

    await this.ensurePaths();

    if (this.providedGithubToken) {
      if (this.verbose) {
        console.log('🔧 DEBUG: Using provided GitHub token from constructor');
      }
      this.githubToken = this.providedGithubToken;
      console.log('✓ Using provided GitHub token from environment');
    } else {
      if (this.verbose) {
        console.log('🔧 DEBUG: No provided token, calling setupGitHubToken()');
      }
      await this.setupGitHubToken();
    }

    console.log('🔄 Setting up GitHub Copilot token...');
    if (this.verbose) {
      console.log('🔧 DEBUG: Calling setupCopilotToken()');
    }
    await this.setupCopilotToken();
    console.log('✅ GitHub Copilot authentication successful!');
    if (this.verbose) {
      console.log('🔧 DEBUG: initialize() completed successfully');
    }
  }

  async getCopilotToken(): Promise<string> {
    // Check if token exists
    if (!this.copilotToken) {
      throw new Error('Copilot token not available');
    }

    // Check if token is expired (with 5 minute buffer)
    if (this.copilotTokenExpiresAt) {
      const now = Date.now() / 1000; // Current time in seconds
      const buffer = 5 * 60; // 5 minute buffer

      if (now >= this.copilotTokenExpiresAt - buffer) {
        if (this.verbose) {
          console.log(
            '🔄 Copilot token expired or expiring soon, refreshing...',
          );
        }

        try {
          // Refresh the token
          const newTokenResponse = await this.getCopilotTokenFromAPI();
          this.copilotToken = newTokenResponse.token;
          this.copilotTokenExpiresAt = newTokenResponse.expires_at;

          // Clear old timeout and set up new refresh
          if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
          }
          await this.setupAutoRefresh(newTokenResponse);

          if (this.verbose) {
            console.log('✅ Copilot token refreshed successfully');
          }
        } catch (error) {
          console.error(
            '❌ Failed to refresh expired token:',
            error instanceof Error ? error.message : error,
          );
          throw new Error('Failed to refresh expired Copilot token');
        }
      }
    }

    return this.copilotToken;
  }

  private async ensurePaths(): Promise<void> {
    if (this.verbose) {
      console.log(
        '🔧 DEBUG: ensurePaths() - Creating app directory:',
        this.APP_DIR,
      );
    }
    await fs.mkdir(this.APP_DIR, { recursive: true });

    try {
      await fs.access(this.GITHUB_TOKEN_PATH, fs.constants.F_OK);
      if (this.verbose) {
        console.log(
          '🔧 DEBUG: GitHub token file exists:',
          this.GITHUB_TOKEN_PATH,
        );
      }
    } catch {
      if (this.verbose) {
        console.log(
          '🔧 DEBUG: Creating new GitHub token file:',
          this.GITHUB_TOKEN_PATH,
        );
      }
      await fs.writeFile(this.GITHUB_TOKEN_PATH, '');
      await fs.chmod(this.GITHUB_TOKEN_PATH, 0o600);
    }
  }

  private async setupGitHubToken(): Promise<void> {
    // Reset cancellation flag for new authentication attempt
    this.pollingCancelled = false;

    if (this.verbose) {
      console.log('🔧 DEBUG: setupGitHubToken() started');
    }

    try {
      const savedToken = await this.readGithubToken();
      if (this.verbose) {
        console.log(
          '🔧 DEBUG: Read saved token result:',
          savedToken ? '[TOKEN_FOUND]' : '[NO_TOKEN]',
        );
      }

      if (savedToken) {
        console.log('🔍 Found existing GitHub token, verifying...');
        this.githubToken = savedToken;
        try {
          await this.verifyGitHubUser();
          console.log('✓ Existing GitHub token verified successfully');
          return;
        } catch (verifyError) {
          // Token is invalid, delete it and continue to OAuth flow
          console.log('⚠️  Saved token is invalid, removing it...');
          if (this.verbose) {
            console.log(
              '🔧 DEBUG: Token verification failed:',
              verifyError instanceof Error ? verifyError.message : verifyError,
            );
          }
          await this.writeGithubToken(''); // Clear the invalid token
          this.githubToken = null;
        }
      }

      console.log('🔑 No existing GitHub token found, starting OAuth flow...');
      console.log(
        '📱 Please complete the GitHub authentication in your browser',
      );

      if (this.verbose) {
        console.log('🔧 DEBUG: Calling getDeviceCode()');
      }
      const deviceCode = await this.getDeviceCode();
      if (this.verbose) {
        console.log('🔧 DEBUG: Device code response:', {
          user_code: deviceCode.user_code,
          verification_uri: deviceCode.verification_uri,
          expires_in: deviceCode.expires_in,
          interval: deviceCode.interval,
        });
      }

      console.log('');
      console.log('─'.repeat(60));
      console.log(`🔗 Please visit: ${deviceCode.verification_uri}`);
      console.log(`🔢 Enter this code: ${deviceCode.user_code}`);
      console.log('─'.repeat(60));
      console.log('⏳ Waiting for authentication...');

      if (this.verbose) {
        console.log('🔧 DEBUG: Starting pollAccessToken()');
      }
      const token = await this.pollAccessToken(deviceCode);
      if (this.verbose) {
        console.log('🔧 DEBUG: pollAccessToken() completed, token received');
      }

      await this.writeGithubToken(token);
      this.githubToken = token;

      console.log('✅ GitHub authentication completed successfully!');
      await this.verifyGitHubUser();
    } catch (error) {
      if (this.verbose) {
        console.log('🔧 DEBUG: setupGitHubToken() error:', error);
      }
      console.error(
        '❌ Failed to authenticate with GitHub:',
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  private async setupCopilotToken(): Promise<void> {
    try {
      const tokenResponse = await this.getCopilotTokenFromAPI();
      this.copilotToken = tokenResponse.token;
      this.copilotTokenExpiresAt = tokenResponse.expires_at;
      console.log('✓ GitHub Copilot token acquired successfully');

      await this.setupAutoRefresh(tokenResponse);
    } catch (error) {
      console.error(
        '❌ Failed to setup GitHub Copilot token:',
        error instanceof Error ? error.message : error,
      );
      throw error;
    }
  }

  private async setupAutoRefresh(
    tokenResponse: CopilotTokenResponse,
  ): Promise<void> {
    // Set up automatic refresh - refresh 60 seconds before expiration
    const refreshInterval = (tokenResponse.refresh_in - 60) * 1000;
    if (refreshInterval > 0) {
      this.refreshTimeout = setTimeout(async () => {
        try {
          const newTokenResponse = await this.getCopilotTokenFromAPI();
          this.copilotToken = newTokenResponse.token;
          this.copilotTokenExpiresAt = newTokenResponse.expires_at;
          console.log('🔄 GitHub Copilot token refreshed successfully');
          // Set up next refresh
          await this.setupAutoRefresh(newTokenResponse);
        } catch (error) {
          console.error(
            '❌ Failed to refresh Copilot token:',
            error instanceof Error ? error.message : error,
          );
        }
      }, refreshInterval);
    }
  }

  private async readGithubToken(): Promise<string | null> {
    try {
      const token = await fs.readFile(this.GITHUB_TOKEN_PATH, 'utf8');
      return token.trim() || null;
    } catch {
      return null;
    }
  }

  private async writeGithubToken(token: string): Promise<void> {
    await fs.writeFile(this.GITHUB_TOKEN_PATH, token);
    await fs.chmod(this.GITHUB_TOKEN_PATH, 0o600);
  }

  private async getDeviceCode(): Promise<DeviceCodeResponse> {
    if (this.verbose) {
      console.log('🔧 DEBUG: getDeviceCode() - Making request to GitHub');
      console.log(
        '🔧 DEBUG: URL:',
        `${this.GITHUB_BASE_URL}/login/device/code`,
      );
      console.log('🔧 DEBUG: Client ID:', this.GITHUB_CLIENT_ID);
    }

    const response = await fetch(`${this.GITHUB_BASE_URL}/login/device/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'GeminiCLI',
      },
      body: JSON.stringify({
        client_id: this.GITHUB_CLIENT_ID,
        scope: 'read:user',
      }),
    });

    if (this.verbose) {
      console.log(
        '🔧 DEBUG: getDeviceCode() response status:',
        response.status,
      );
      console.log('🔧 DEBUG: getDeviceCode() response ok:', response.ok);
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (this.verbose) {
        console.log('🔧 DEBUG: getDeviceCode() error response:', errorText);
      }
      throw new Error(
        `Failed to get device code: ${response.statusText} - ${errorText}`,
      );
    }

    const result = (await response.json()) as DeviceCodeResponse;
    if (this.verbose) {
      console.log('🔧 DEBUG: getDeviceCode() success');
    }
    return result;
  }

  private async pollAccessToken(
    deviceCode: DeviceCodeResponse,
  ): Promise<string> {
    const sleepDuration = (deviceCode.interval + 1) * 1000;
    let attempts = 0;
    const maxAttempts = Math.ceil(
      deviceCode.expires_in / (deviceCode.interval + 1),
    );

    if (this.verbose) {
      console.log('🔧 DEBUG: pollAccessToken() started');
      console.log('🔧 DEBUG: Sleep duration:', sleepDuration, 'ms');
      console.log('🔧 DEBUG: Max attempts:', maxAttempts);
      console.log(
        '🔧 DEBUG: Device code expires in:',
        deviceCode.expires_in,
        'seconds',
      );
    }

    while (attempts < maxAttempts) {
      attempts++;

      // Check if polling has been cancelled
      if (this.pollingCancelled) {
        if (this.verbose) {
          console.log('🔧 DEBUG: Polling cancelled, exiting loop');
        }
        throw new Error('Authentication polling was cancelled');
      }

      if (this.verbose) {
        console.log(`🔧 DEBUG: Poll attempt ${attempts}/${maxAttempts}`);
      }

      const response = await fetch(
        `${this.GITHUB_BASE_URL}/login/oauth/access_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'GeminiCLI',
          },
          body: JSON.stringify({
            client_id: this.GITHUB_CLIENT_ID,
            device_code: deviceCode.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        },
      );

      if (this.verbose) {
        console.log('🔧 DEBUG: Poll response status:', response.status);
        console.log('🔧 DEBUG: Poll response ok:', response.ok);
      }

      // GitHub's device flow always returns 200 with error codes in JSON
      // Parse the JSON response regardless of HTTP status
      let json;
      try {
        json = await response.json();
      } catch (parseError) {
        if (this.verbose) {
          console.log('🔧 DEBUG: Failed to parse JSON response:', parseError);
        }
        if (!response.ok) {
          // Non-OK status and can't parse JSON - treat as error
          if (attempts % 5 === 0) {
            console.log(
              `⏳ Still waiting for authentication... (${attempts}/${maxAttempts})`,
            );
          }
          await this.sleep(sleepDuration);
          continue;
        }
        throw new Error('Invalid response from GitHub OAuth');
      }
      if (this.verbose) {
        console.log('🔧 DEBUG: Poll response JSON:', {
          hasError: !!json.error,
          error: json.error,
          hasAccessToken: !!json.access_token,
        });
      }

      // Handle error responses
      if (json.error) {
        if (json.error === 'authorization_pending') {
          if (this.verbose) {
            console.log('🔧 DEBUG: Still pending authorization...');
          }
          if (attempts % 5 === 0) {
            console.log(
              `⏳ Still waiting for authentication... (${attempts}/${maxAttempts})`,
            );
          }
          await this.sleep(sleepDuration);
          continue;
        } else if (json.error === 'slow_down') {
          if (this.verbose) {
            console.log('🔧 DEBUG: Rate limited, slowing down...');
          }
          console.log('⚠️  Slowing down polling rate...');
          await this.sleep(sleepDuration * 2);
          continue;
        } else if (json.error === 'expired_token') {
          if (this.verbose) {
            console.log('🔧 DEBUG: Token expired');
          }
          throw new Error('❌ Authentication code expired. Please try again.');
        } else if (json.error === 'access_denied') {
          if (this.verbose) {
            console.log('🔧 DEBUG: Access denied');
          }
          throw new Error('❌ Authentication was denied. Please try again.');
        }
        if (this.verbose) {
          console.log('🔧 DEBUG: Unknown OAuth error:', json.error);
        }
        throw new Error(`OAuth error: ${json.error_description || json.error}`);
      }

      const { access_token } = json as AccessTokenResponse;

      if (access_token) {
        if (this.verbose) {
          console.log('🔧 DEBUG: Access token received successfully');
        }
        console.log('✅ GitHub OAuth authentication successful!');
        return access_token;
      } else {
        if (this.verbose) {
          console.log(
            '🔧 DEBUG: No access token in response, continuing to poll...',
          );
        }
        if (attempts % 5 === 0) {
          console.log(
            `⏳ Still waiting for authentication... (${attempts}/${maxAttempts})`,
          );
        }
        await this.sleep(sleepDuration);
      }
    }

    if (this.verbose) {
      console.log('🔧 DEBUG: Maximum attempts reached, timing out');
    }
    throw new Error('❌ Authentication timeout. Please try again.');
  }

  private async getCopilotTokenFromAPI(): Promise<CopilotTokenResponse> {
    if (!this.githubToken) {
      throw new Error('GitHub token not available');
    }

    if (this.verbose) {
      console.log(
        '🔧 DEBUG: getCopilotTokenFromAPI() - Making request to GitHub Copilot API',
      );
      console.log(
        '🔧 DEBUG: URL:',
        `${this.GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
      );
    }

    const response = await fetch(
      `${this.GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
      {
        headers: {
          Authorization: `token ${this.githubToken}`,
          Accept: 'application/json',
          'User-Agent': 'GeminiCLI',
          'editor-version': 'vscode/1.95.0',
          'editor-plugin-version': 'copilot/1.234.0',
          'openai-organization': 'github-copilot',
          'openai-intent': 'conversation-panel',
          'Content-Type': 'application/json',
          'x-github-api-version': '2025-04-01',
        },
      },
    );

    if (this.verbose) {
      console.log('🔧 DEBUG: Copilot token response status:', response.status);
      console.log('🔧 DEBUG: Copilot token response ok:', response.ok);
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (this.verbose) {
        console.log('🔧 DEBUG: Copilot token error response:', errorText);
      }
      throw new Error(
        `Failed to get Copilot token: ${response.statusText} - ${errorText}`,
      );
    }

    const result = (await response.json()) as CopilotTokenResponse;
    if (this.verbose) {
      console.log('🔧 DEBUG: Copilot token received successfully');
      console.log(
        '🔧 DEBUG: Token expires at:',
        new Date(result.expires_at * 1000).toISOString(),
      );
      console.log('🔧 DEBUG: Refresh in:', result.refresh_in, 'seconds');
    }
    return result;
  }

  private async verifyGitHubUser(): Promise<void> {
    if (!this.githubToken) {
      throw new Error('GitHub token not available');
    }

    const response = await fetch(`${this.GITHUB_API_BASE_URL}/user`, {
      headers: {
        Authorization: `token ${this.githubToken}`,
        Accept: 'application/json',
        'User-Agent': 'GeminiCLI',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to verify GitHub user: ${response.statusText}`);
    }

    const user = (await response.json()) as GitHubUser;
    console.log(`👤 Authenticated as: ${user.login}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  destroy(): void {
    // Cancel any ongoing polling
    this.pollingCancelled = true;

    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }
}
