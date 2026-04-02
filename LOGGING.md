# Logging System

This document describes the logging system implemented to reduce console noise and improve performance.

## Overview

The application now uses a centralized logging system that:
- Reduces console noise in production
- Provides conditional debug logging
- Improves performance by removing debug logs in production builds
- Allows developers to enable debug logging when needed

## Usage

### For Developers

In development mode, you can control logging from the browser console:

```javascript
// Enable debug logging
imwaldDebug.enable()

// Disable debug logging
imwaldDebug.disable()

// Check current status
imwaldDebug.status()

// Use debug logging directly
imwaldDebug.log('Debug message', data)
imwaldDebug.warn('Warning message', data)
imwaldDebug.error('Error message', data)
imwaldDebug.perf('Performance message', data)
```

(`jumbleDebug` is still exposed as an alias for compatibility.)

### For Code

Use the logger instead of direct console statements:

```typescript
import logger from '@/lib/logger'

// Debug logging (only shows in dev mode with debug enabled)
logger.debug('Debug information', data)

// Info logging (always shows)
logger.info('Important information', data)

// Warning logging (always shows)
logger.warn('Warning message', data)

// Error logging (always shows)
logger.error('Error message', data)

// Performance logging (only in dev mode)
logger.perf('Performance metric', data)
```

## Log Levels

- **debug**: Development debugging information (disabled in production)
- **info**: Important application information (always enabled)
- **warn**: Warning messages (always enabled)
- **error**: Error messages (always enabled)
- **perf**: Performance metrics (development only)

## Configuration

The logger automatically configures itself based on:

1. **Environment**: Debug logging is disabled in production builds
2. **Local Storage**: `imwald-debug=true` enables debug mode (legacy: `jumble-debug=true`)
3. **Environment Variable**: `VITE_DEBUG=true` enables debug mode

## Performance Impact

- **Production**: Debug logs are completely removed, improving performance
- **Development**: Debug logs are conditionally enabled, reducing noise
- **Console Operations**: Reduced console.log calls improve browser performance

## Migration

The following files have been updated to use the new logging system:

- `src/providers/FeedProvider.tsx` - Feed initialization and switching
- `src/pages/primary/DiscussionsPage/index.tsx` - Vote counting and event fetching
- `src/services/client.service.ts` - Relay operations and circuit breaker
- `src/providers/NostrProvider/index.tsx` - Event signing and validation
- `src/components/Note/index.tsx` - Component rendering
- `src/PageManager.tsx` - Page rendering

## Benefits

1. **Reduced Console Noise**: Debug logs are hidden by default
2. **Better Performance**: Fewer console operations in production
3. **Developer Control**: Easy to enable debug logging when needed
4. **Consistent Logging**: Centralized logging with consistent format
5. **Production Ready**: Debug logs are completely removed in production builds

## Debug Mode

To enable debug mode:

1. **In Browser Console** (development only):
   ```javascript
   imwaldDebug.enable()
   ```

2. **Via Local Storage**:
   ```javascript
   localStorage.setItem('imwald-debug', 'true')
   ```

3. **Via Environment Variable**:
   ```bash
   VITE_DEBUG=true npm run dev
   ```

Debug mode will show all debug-level logs with timestamps and log levels.
