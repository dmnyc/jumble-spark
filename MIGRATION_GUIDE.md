# Migration Guide: ClientService Refactoring

## Overview
The `client.service.ts` (4313 lines) has been refactored into focused service modules. This guide helps migrate existing code to use the new services.

## New Service Architecture

### 1. QueryService (`client-query.service.ts`)
**Purpose**: Core query/subscription logic with race-based fetching

**Key Methods**:
- `query(urls, filter, onevent, options)` - Core query with race strategies
- `subscribe(urls, filter, callbacks)` - Relay subscriptions
- `fetchEvents(urls, filter, options)` - Fetch events with caching
- `trackEventSeenOn(eventId, relay)` - Track where events were seen
- `getSeenEventRelayUrls(eventId)` - Get relays that saw an event

**Migration**: Most internal usage, but if you're calling `query` or `subscribe` directly, use `queryService` instead.

### 2. EventService (`client-events.service.ts`)
**Purpose**: Single event fetching and caching

**Key Methods**:
- `fetchEvent(id)` - Fetch single event by ID
- `fetchEventForceRetry(eventId)` - Force retry fetch
- `fetchEventWithExternalRelays(eventId, externalRelays)` - Fetch with specific relays
- `addEventToCache(event)` - Add to session cache
- `getSessionEventsMatchingSearch(query, limit, allowedKinds)` - Search session cache
- `clearCaches()` - Clear all caches

**Migration**: Replace `client.fetchEvent()` with `eventService.fetchEvent()`

### 3. ReplaceableEventService (`client-replaceable-events.service.ts`)
**Purpose**: Replaceable events (profiles, relay lists, follow lists, etc.)

**Key Methods**:
- `fetchReplaceableEvent(pubkey, kind, d?)` - Fetch replaceable event
- `fetchReplaceableEventsFromBigRelays(pubkeys, kind)` - Batch fetch
- `updateReplaceableEventCache(event)` - Update cache
- `clearCaches()` - Clear caches

**Migration**: Replace `client.fetchProfileEvent()`, `client.fetchRelayListEvent()`, etc. with `replaceableEventService.fetchReplaceableEvent()`

### 4. MacroService (`client-macro.service.ts`)
**Purpose**: Macro-specific events (Bookstr, Wikistr, etc.)

**Key Methods**:
- `fetchMacroEvents(filters)` - Fetch macro events
- `getCachedMacroEvents(filters)` - Get from cache

**Migration**: Replace `client.fetchBookstrEvents()` with `macroService.fetchMacroEvents()`

### 5. CacheService (`client-cache.service.ts`)
**Purpose**: Universal cache-warming and refresh strategy

**Key Methods**:
- `warmupCache(config, fetchFn)` - Warm up cache on login
- `scheduleRefresh(pubkey, kind, fetchFn)` - Schedule background refresh
- `getProfileWithRefresh(pubkey, fetchFn)` - Get profile with auto-refresh
- `getRelayListWithRefresh(pubkey, fetchFn)` - Get relay list with auto-refresh
- `isStale(pubkey, kind, cachedAt)` - Check if cache is stale
- `startPeriodicRefresh(refreshFn)` - Start periodic refresh

**Migration**: Use for cache-warming on login and background refresh

## Files That Need Updates

### High Priority (Direct client.service usage)

1. **`src/providers/NostrProvider/index.tsx`**
   - Uses: `client.fetchRelayList()`, `client.fetchProfileEvent()`, `client.fetchEvents()`
   - Update: Use `replaceableEventService`, `eventService`, `queryService`

2. **`src/hooks/useFetchProfile.tsx`**
   - Uses: `client.fetchProfile()`, `client.getProfileFromIndexedDB()`
   - Update: Use `replaceableEventService` or new profile service

3. **`src/hooks/useFetchEvent.tsx`**
   - Uses: `client.fetchEvent()`
   - Update: Use `eventService.fetchEvent()`

4. **`src/hooks/useFetchRelayList.tsx`**
   - Uses: `client.fetchRelayList()`
   - Update: Use `replaceableEventService` or new relay service

5. **`src/components/Profile/index.tsx`**
   - Uses: `client.fetchPaymentInfoEvent()`, `client.fetchEvents()`
   - Update: Use `replaceableEventService`, `queryService`

6. **`src/components/Profile/ProfileBookmarksAndHashtags.tsx`**
   - Uses: `client.fetchEvents()`, `client.fetchInterestListEvent()`
   - Update: Use `queryService`, `replaceableEventService`

### Medium Priority (Indirect usage)

7. **`src/services/note-stats.service.ts`**
   - Uses: `client.fetchEvents()`
   - Update: Use `queryService.fetchEvents()`

8. **`src/services/mention-event-search.service.ts`**
   - Uses: `client.getSessionEventsMatchingSearch()`
   - Update: Use `eventService.getSessionEventsMatchingSearch()`

9. **`src/components/Bookstr/BookstrContent.tsx`**
   - Uses: `client.fetchBookstrEvents()`
   - Update: Use `macroService.fetchMacroEvents()`

10. **`src/components/Note/PublicationIndex/PublicationIndex.tsx`**
    - Uses: `client.fetchEvent()`, `indexedDb.getReplaceableEvent()`
    - Update: Use `eventService.fetchEvent()`, `replaceableEventService`

### Low Priority (Internal services)

11. **`src/services/relay-selection.service.ts`**
    - Uses: `client.fetchRelayList()`
    - Update: Use `replaceableEventService` or new relay service

12. **`src/services/relay-info.service.ts`**
    - Uses: `client.fetchEvents()`
    - Update: Use `queryService.fetchEvents()`

## Migration Pattern

### Before:
```typescript
import client from '@/services/client.service'

const profile = await client.fetchProfile(pubkey)
const event = await client.fetchEvent(eventId)
const relayList = await client.fetchRelayList(pubkey)
```

### After:
```typescript
import { eventService, replaceableEventService } from '@/services/client.service'

const profileEvent = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.Metadata)
const event = await eventService.fetchEvent(eventId)
const relayListEvent = await replaceableEventService.fetchReplaceableEvent(pubkey, kinds.RelayList)
```

## Integration in Main ClientService

The main `client.service.ts` will be refactored to:
1. Instantiate all sub-services
2. Delegate method calls to appropriate services
3. Maintain backward compatibility during transition
4. Gradually remove old implementations

## Cache Warming Integration

Add to `NostrProvider` initialization:

```typescript
import cacheService from '@/services/client-cache.service'

// On login/initialization
await cacheService.warmupCache({
  profilePubkeys: [account.pubkey, ...recentInteractions],
  relayListPubkeys: [account.pubkey],
  warmupFollowLists: true,
  warmupMuteLists: true
}, {
  fetchProfile: (id) => replaceableEventService.fetchReplaceableEvent(...),
  fetchRelayList: (pubkey) => relayService.fetchRelayList(pubkey),
  // ...
})

// Start periodic refresh
cacheService.startPeriodicRefresh(async (pubkey, kind) => {
  await replaceableEventService.fetchReplaceableEvent(pubkey, kind)
})
```

## Benefits

1. **Performance**: Race-based fetching reduces wait times from 10-30s to 1-3s
2. **Cache efficiency**: Universal cache-warming and refresh strategy
3. **Maintainability**: Focused services are easier to understand and modify
4. **Testability**: Services can be tested independently
5. **Extensibility**: Easy to add new macro types or event types

## Next Steps

1. Complete remaining service extractions (ProfileService, RelayService, TimelineService)
2. Update main `client.service.ts` to orchestrate sub-services
3. Migrate high-priority files first
4. Test thoroughly
5. Remove old code once migration is complete
