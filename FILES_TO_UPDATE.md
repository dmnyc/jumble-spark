# Files That Should Use Central Services

## Summary
After refactoring `client.service.ts` into focused services, these files should be updated to use the new central services instead of direct client.service calls or bypassing the service layer.

## High Priority Updates

### 1. `src/hooks/useFetchProfile.tsx`
**Current**: Uses `client.getProfileFromIndexedDB()` and `client.fetchProfile()`
**Should Use**: `replaceableEventService.fetchReplaceableEvent()` or new ProfileService
**Benefit**: Gets cache-warming and refresh benefits

### 2. `src/hooks/useFetchEvent.tsx`
**Current**: Directly accesses `client.eventCacheMap` (line 26)
**Should Use**: `eventService.fetchEvent()` and `eventService.getSessionEventsMatchingSearch()`
**Benefit**: Proper encapsulation, better caching

### 3. `src/components/Note/PublicationIndex/PublicationIndex.tsx`
**Current**: 
- Directly uses `indexedDb.getReplaceableEvent()` (line 686)
- Uses `client.fetchEvent()` (line 707)
- Has custom `fetchEventFromRelay()` function
**Should Use**: 
- `replaceableEventService.fetchReplaceableEvent()`
- `eventService.fetchEvent()`
- `queryService.fetchEvents()` instead of custom relay fetching
**Benefit**: Consistent caching and race-based fetching

### 4. `src/services/note-stats.service.ts`
**Current**: Uses `client.fetchEvents()` (line 128)
**Should Use**: `queryService.fetchEvents()`
**Benefit**: Race-based fetching, better performance

### 5. `src/components/Profile/ProfileBookmarksAndHashtags.tsx`
**Current**: 
- Uses `client.fetchEvents()` directly (line 292)
- Uses `client.fetchInterestListEvent()` (line 300)
**Should Use**: 
- `queryService.fetchEvents()`
- `replaceableEventService.fetchReplaceableEvent(pubkey, 10015)`
**Benefit**: Consistent query strategies

### 6. `src/components/SimpleNoteFeed/index.tsx`
**Current**: Uses `client.fetchEvents()` (line 89)
**Should Use**: `queryService.fetchEvents()`
**Benefit**: Race-based fetching for better performance

## Medium Priority Updates

### 7. `src/services/mention-event-search.service.ts`
**Current**: Likely uses `client.getSessionEventsMatchingSearch()`
**Should Use**: `eventService.getSessionEventsMatchingSearch()`
**Benefit**: Proper service encapsulation

### 8. `src/components/Bookstr/BookstrContent.tsx`
**Current**: Uses `client.fetchBookstrEvents()`
**Should Use**: `macroService.fetchMacroEvents()` (with type='bookstr')
**Benefit**: Uses new MacroService architecture

### 9. `src/services/relay-selection.service.ts`
**Current**: Uses `client.fetchRelayList()` and `client.getSessionSuccessfulPublishRelayUrlsForRandomPool()`
**Should Use**: New RelayService (to be created)
**Benefit**: Proper relay management

### 10. `src/providers/NostrProvider/index.tsx`
**Current**: Extensive use of `client.fetchRelayList()`, `client.fetchEvents()`, etc.
**Should Use**: All new services
**Benefit**: Cache-warming integration, better performance

## Low Priority (Internal Services)

### 11. `src/services/gif.service.ts`
**Check**: If it uses `client.fetchEvents()` directly
**Should Use**: `queryService.fetchEvents()`

### 12. `src/services/lightning.service.ts`
**Check**: If it fetches events directly
**Should Use**: Appropriate service

### 13. `src/components/Embedded/EmbeddedNote.tsx`
**Check**: If it uses `client.fetchEvent()` directly
**Should Use**: `eventService.fetchEvent()`

## Cache Integration Opportunities

### Files That Should Use CacheService

1. **`src/providers/NostrProvider/index.tsx`**
   - Add cache-warming on login
   - Use `cacheService.warmupCache()` in initialization
   - Use `cacheService.getProfileWithRefresh()` for profiles
   - Use `cacheService.getRelayListWithRefresh()` for relay lists

2. **`src/hooks/useFetchProfile.tsx`**
   - Use `cacheService.getProfileWithRefresh()` instead of manual cache checking
   - Gets automatic background refresh for stale profiles

3. **`src/hooks/useFetchRelayList.tsx`**
   - Use `cacheService.getRelayListWithRefresh()` instead of manual cache checking

## Direct IndexedDB Access to Replace

### Files Accessing IndexedDB Directly (Should Use Services)

1. **`src/components/Note/PublicationIndex/PublicationIndex.tsx`**
   - Line 686: `indexedDb.getReplaceableEvent()` → Use `replaceableEventService`
   - Line 930: `indexedDb.getPublicationEvent()` → Use appropriate service
   - Line 934: `indexedDb.getEventFromPublicationStore()` → Use `eventService`

2. **`src/components/Profile/index.tsx`**
   - Check for direct IndexedDB access for payment info
   - Should use `replaceableEventService.fetchReplaceableEvent(pubkey, ExtendedKind.PAYMENT_INFO)`

## Migration Order

1. **Phase 1**: Update hooks (`useFetchProfile`, `useFetchEvent`, `useFetchRelayList`)
   - These are used everywhere, so fixing them benefits all components

2. **Phase 2**: Update core components (`Profile`, `PublicationIndex`)
   - High-impact components that users interact with frequently

3. **Phase 3**: Update services (`note-stats`, `mention-event-search`)
   - Internal services that can be updated without UI changes

4. **Phase 4**: Update providers (`NostrProvider`)
   - Add cache-warming and refresh strategies

5. **Phase 5**: Update remaining components
   - Lower priority, but should be done for consistency

## Testing Checklist

After migration, verify:
- [ ] Profiles load quickly (cache-first)
- [ ] Events load quickly (race-based fetching)
- [ ] Cache refreshes in background for stale data
- [ ] No duplicate network requests
- [ ] Cache-warming works on login
- [ ] Background refresh doesn't block UI
