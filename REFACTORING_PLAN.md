# ClientService Refactoring Plan

## Overview
Breaking down the 4313-line `client.service.ts` into focused, maintainable services with universal cache-warming strategy.

## Service Architecture

### 1. **QueryService** (`client-query.service.ts`) ✅
- Core query/subscription logic
- Race-based fetching strategies
- Relay connection management
- Event tracking

### 2. **CacheService** (`client-cache.service.ts`) ✅
- Universal cache-warming strategy
- Cache refresh scheduling
- TTL management
- Background refresh coordination

### 3. **EventService** (`client-events.service.ts`) ✅
- Single event fetching
- Event caching
- Session cache management
- DataLoader integration

### 4. **ReplaceableEventService** (`client-replaceable-events.service.ts`) ✅
- Replaceable event fetching (profiles, relay lists, etc.)
- Batch operations
- Cache coordination

### 5. **MacroService** (`client-macro.service.ts`) ✅
- Macro-specific event fetching (Bookstr, etc.)
- Macro metadata extraction
- Specialized filtering
- Extensible for future macro types

### 6. **CacheService** (`client-cache.service.ts`) ✅
- Universal cache-warming strategy
- Cache refresh scheduling
- TTL management
- Background refresh coordination

### Note on Additional Services
The following services were considered but are currently handled within `ClientService` as orchestration logic:
- **Profile search/index**: Handled in `ClientService` with delegation to `ReplaceableEventService` for fetching
- **Relay management**: Publishing and relay selection remain in `ClientService` as core orchestration
- **Timeline subscriptions**: Complex state management remains in `ClientService` but uses `QueryService` and `EventService`

## Cache Strategy

### Cache-Warming
- On login: Warm up current user's profile, relay list, follow list
- On feed load: Warm up profiles for visible pubkeys (batch, limited to 50)
- Background: Periodically refresh stale entries

### Cache-Refreshing
- Stale detection: Check `addedAt` timestamp vs refresh thresholds
- Background refresh: Non-blocking, queued refresh for stale entries
- Periodic refresh: Every 5 minutes, check and refresh stale profiles

### TTLs
- Profiles: 30 min cache, 15 min refresh threshold
- Payment info: 5 min cache, 2 min refresh threshold
- Relay lists: 15 min cache, 10 min refresh threshold
- Follow/Mute lists: 60 min cache, 30 min refresh threshold

## Integration Strategy

1. Create service instances in main `ClientService`
2. Inject dependencies (QueryService into others)
3. Maintain backward compatibility during transition
4. Gradually migrate methods to use new services
5. Remove old code once migration complete

## Performance Benefits

- **Faster initial load**: Cache-warming pre-fetches critical data
- **Better responsiveness**: Background refresh keeps cache fresh without blocking UI
- **Reduced network calls**: Smart cache invalidation prevents unnecessary fetches
- **Improved maintainability**: Focused services are easier to test and modify
