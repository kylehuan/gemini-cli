# Provider Structure

This folder contains different provider implementations for OpenAI-compatible
APIs used in gemini-cli. Each provider handles specific API requirements,
authentication methods, and request transformations.

## File Structure

- `types.ts` - Type definitions and interfaces for providers
- `default.ts` - Default provider for standard OpenAI-compatible APIs
- `dashscope.ts` - DashScope (Qwen) specific provider implementation
- `openrouter.ts` - OpenRouter specific provider implementation
- `githubCopilot.ts` - GitHub Copilot specific provider implementation
- `githubCopilotAuthManager.ts` - Authentication manager for GitHub Copilot
  (OAuth device flow)
- `index.ts` - Main export file for all providers

## Provider Types

### Default Provider (`default.ts`)

The `DefaultOpenAICompatibleProvider` is the fallback provider for standard
OpenAI-compatible APIs. It provides basic functionality without special
enhancements and passes through all request parameters with standard headers.

**Features:**

- Standard User-Agent header generation
- Basic OpenAI client configuration
- Pass-through request handling
- Configurable timeout and retry settings

### DashScope Provider (`dashscope.ts`)

The `DashScopeOpenAICompatibleProvider` handles DashScope (Qwen) specific
features including cache control and metadata tracking.

**Features:**

- Automatic cache control injection for system and last messages
- Session ID and prompt ID metadata tracking
- Support for both streaming and non-streaming requests
- Configurable cache control (can be disabled via config)
- Custom headers: `X-DashScope-CacheControl`, `X-DashScope-UserAgent`,
  `X-DashScope-AuthType`
- OAuth authentication support

**Identification:**

- `authType === 'QWEN_OAUTH'`
- Base URLs: `https://dashscope.aliyuncs.com/compatible-mode/v1` or
  `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`

### OpenRouter Provider (`openrouter.ts`)

The `OpenRouterOpenAICompatibleProvider` extends the default provider with
OpenRouter-specific headers.

**Features:**

- Inherits all default provider functionality
- Adds `HTTP-Referer` and `X-Title` headers for OpenRouter tracking

**Identification:**

- Base URL contains `openrouter.ai`

### GitHub Copilot Provider (`githubCopilot.ts`)

The `GitHubCopilotOpenAICompatibleProvider` handles GitHub Copilot API
authentication and request formatting.

**Features:**

- OAuth device flow authentication via `GitHubCopilotAuthManager`
- Custom fetch implementation for token injection
- Comprehensive GitHub Copilot headers (editor version, plugin version, API
  version)
- Automatic token refresh with expiration handling
- Singleton authentication manager to prevent duplicate auth flows
- Support for individual and enterprise accounts

**Special Headers:**

- `copilot-integration-id`, `editor-version`, `editor-plugin-version`
- `openai-intent`, `x-github-api-version`, `x-request-id`
- `X-Initiator`

**Identification:**

- `authType === 'github-copilot'`
- Base URL contains `githubcopilot.com`

**Additional Methods:**

- `getCopilotToken()` - Get current Copilot token
- `getAuthHeaders()` - Get all authentication headers
- `getBaseUrl()` - Get the API base URL
- `destroy()` - Clean up resources

### GitHub Copilot Auth Manager (`githubCopilotAuthManager.ts`)

A singleton authentication manager that handles the OAuth device flow for GitHub
Copilot.

**Features:**

- OAuth 2.0 device authorization flow
- Token persistence in `~/.local/share/gemini-cli/github_token`
- Automatic token refresh before expiration
- Token validation and re-authentication on failure
- Singleton pattern to prevent duplicate authentication attempts
- User-friendly device code display and polling
- Rate limiting and timeout handling

**Flow:**

1. Check for existing saved token
2. Verify token validity
3. If invalid or missing, initiate device flow
4. Display verification URL and code to user
5. Poll for authorization completion
6. Exchange device code for access token
7. Use access token to get Copilot token
8. Set up automatic refresh

## Provider Interface

All providers must implement the `OpenAICompatibleProvider` interface:

```typescript
export interface OpenAICompatibleProvider {
  buildHeaders(): Record<string, string | undefined>;
  buildClient(): OpenAI;
  buildRequest(
    request: OpenAI.Chat.ChatCompletionCreateParams,
    userPromptId: string,
  ): OpenAI.Chat.ChatCompletionCreateParams;
}
```

**Methods:**

- `buildHeaders()` - Build HTTP headers for the provider
- `buildClient()` - Create and configure the OpenAI client
- `buildRequest()` - Transform requests before sending to the provider

## Adding a New Provider

To add a new provider:

1. **Create Provider File**: Create a new file (e.g., `newprovider.ts`) in this
   folder
2. **Implement Interface**: Implement the `OpenAICompatibleProvider` interface
3. **Add Static Identifier**: Add a static method to identify if a config
   belongs to this provider:
   ```typescript
   static isNewProviderProvider(
     contentGeneratorConfig: ContentGeneratorConfig,
   ): boolean {
     // Logic to identify this provider
     return contentGeneratorConfig.baseUrl?.includes('newprovider.com') || false;
   }
   ```
4. **Export**: Export the class from `index.ts`
5. **Register**: Update the provider selection logic in the parent module to use
   your identifier

## Example Implementation

```typescript
export class NewProviderOpenAICompatibleProvider
  implements OpenAICompatibleProvider
{
  private contentGeneratorConfig: ContentGeneratorConfig;
  private cliConfig: Config;

  constructor(
    contentGeneratorConfig: ContentGeneratorConfig,
    cliConfig: Config,
  ) {
    this.contentGeneratorConfig = contentGeneratorConfig;
    this.cliConfig = cliConfig;
  }

  static isNewProviderProvider(
    contentGeneratorConfig: ContentGeneratorConfig,
  ): boolean {
    return contentGeneratorConfig.baseUrl?.includes('newprovider.com') || false;
  }

  buildHeaders(): Record<string, string | undefined> {
    return {
      'User-Agent': 'GeminiCLI/1.0',
      'X-Custom-Header': 'value',
    };
  }

  buildClient(): OpenAI {
    const { apiKey, baseUrl, timeout, maxRetries } =
      this.contentGeneratorConfig;
    return new OpenAI({
      apiKey,
      baseURL: baseUrl,
      timeout,
      maxRetries,
      defaultHeaders: this.buildHeaders(),
    });
  }

  buildRequest(
    request: OpenAI.Chat.ChatCompletionCreateParams,
    userPromptId: string,
  ): OpenAI.Chat.ChatCompletionCreateParams {
    // Add custom transformations
    return {
      ...request,
      // Custom modifications
    };
  }
}
```

## Type Extensions

The `types.ts` file includes extended types for provider-specific features:

- `ChatCompletionContentPartTextWithCache` - Extends OpenAI text parts with
  cache control for DashScope
- `ChatCompletionContentPartWithCache` - Union type for all content parts with
  cache support
- `DashScopeRequestMetadata` - Metadata structure for DashScope requests with
  session and prompt tracking
