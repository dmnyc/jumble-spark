/**
 * Navigation Service
 * 
 * Centralized navigation management for the application.
 * Handles all navigation logic in a clean, testable way.
 */

import React, { ReactNode } from 'react'

// Page components
import SettingsPage from '@/pages/secondary/SettingsPage'
import RelaySettingsPage from '@/pages/secondary/RelaySettingsPage'
import WalletPage from '@/pages/secondary/WalletPage'
import PostSettingsPage from '@/pages/secondary/PostSettingsPage'
import GeneralSettingsPage from '@/pages/secondary/GeneralSettingsPage'
import TranslationPage from '@/pages/secondary/TranslationPage'
import RssFeedSettingsPage from '@/pages/secondary/RssFeedSettingsPage'
import NotePage from '@/pages/secondary/NotePage'
import SecondaryProfilePage from '@/pages/secondary/ProfilePage'
import FollowingListPage from '@/pages/secondary/FollowingListPage'
import MuteListPage from '@/pages/secondary/MuteListPage'
import OthersRelaySettingsPage from '@/pages/secondary/OthersRelaySettingsPage'
import SecondaryRelayPage from '@/pages/secondary/RelayPage'
import SecondaryNoteListPage from '@/pages/secondary/NoteListPage'

export type ViewType = 'note' | 'settings' | 'settings-sub' | 'profile' | 'hashtag' | 'relay' | 'following' | 'mute' | 'others-relay-settings' | null

export interface NavigationContext {
  setPrimaryNoteView: (view: ReactNode, type: ViewType) => void
}

export interface NavigationResult {
  component: ReactNode
  viewType: ViewType
}

/**
 * URL parsing utilities
 */
export class URLParser {
  static extractNoteId(url: string): string {
    return url.replace('/notes/', '')
  }

  static extractRelayUrl(url: string): string {
    return decodeURIComponent(url.replace('/relays/', ''))
  }

  static extractProfileId(url: string): string {
    return url.replace('/users/', '')
  }

  static extractHashtag(url: string): string {
    const searchParams = new URLSearchParams(url.split('?')[1] || '')
    return searchParams.get('t') || ''
  }

  static isSettingsSubPage(url: string): boolean {
    return url.startsWith('/settings/') && url !== '/settings'
  }

  static getSettingsSubPageType(url: string): string {
    if (url.includes('/general')) return 'general'
    if (url.includes('/relays')) return 'relays'
    if (url.includes('/wallet')) return 'wallet'
    if (url.includes('/posts')) return 'posts'
    if (url.includes('/translation')) return 'translation'
    if (url.includes('/rss-feeds')) return 'rss-feeds'
    return 'general'
  }
}

/**
 * Component factory for creating page components
 */
export class ComponentFactory {
  static createNotePage(noteId: string): ReactNode {
    return React.createElement(NotePage, { id: noteId, index: 0, hideTitlebar: true })
  }

  static createRelayPage(relayUrl: string): ReactNode {
    return React.createElement(SecondaryRelayPage, { url: relayUrl, index: 0, hideTitlebar: true })
  }

  static createProfilePage(profileId: string): ReactNode {
    return React.createElement(SecondaryProfilePage, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createHashtagPage(): ReactNode {
    return React.createElement(SecondaryNoteListPage, { hideTitlebar: true })
  }

  static createFollowingListPage(profileId: string): ReactNode {
    return React.createElement(FollowingListPage, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createMuteListPage(_profileId: string): ReactNode {
    return React.createElement(MuteListPage, { index: 0, hideTitlebar: true })
  }

  static createOthersRelaySettingsPage(profileId: string): ReactNode {
    return React.createElement(OthersRelaySettingsPage, { id: profileId, index: 0, hideTitlebar: true })
  }

  static createSettingsPage(): ReactNode {
    return React.createElement(SettingsPage, { index: 0, hideTitlebar: true })
  }

  static createSettingsSubPage(type: string): ReactNode {
    switch (type) {
      case 'relays':
        return React.createElement(RelaySettingsPage, { index: 0, hideTitlebar: true })
      case 'wallet':
        return React.createElement(WalletPage, { index: 0, hideTitlebar: true })
      case 'posts':
        return React.createElement(PostSettingsPage, { index: 0, hideTitlebar: true })
      case 'general':
        return React.createElement(GeneralSettingsPage, { index: 0, hideTitlebar: true })
      case 'translation':
        return React.createElement(TranslationPage, { index: 0, hideTitlebar: true })
      case 'rss-feeds':
        return React.createElement(RssFeedSettingsPage, { index: 0, hideTitlebar: true })
      default:
        return React.createElement(GeneralSettingsPage, { index: 0, hideTitlebar: true })
    }
  }
}

/**
 * Main navigation service
 */
export class NavigationService {
  private context: NavigationContext

  constructor(context: NavigationContext) {
    this.context = context
  }

  /**
   * Navigate to a note
   */
  navigateToNote(url: string): void {
    const noteId = URLParser.extractNoteId(url)
    const component = ComponentFactory.createNotePage(noteId)
    this.updateHistoryAndView(url, component, 'note')
  }

  /**
   * Navigate to a relay
   */
  navigateToRelay(url: string): void {
    const relayUrl = URLParser.extractRelayUrl(url)
    const component = ComponentFactory.createRelayPage(relayUrl)
    this.updateHistoryAndView(url, component, 'relay')
  }

  /**
   * Navigate to a profile
   */
  navigateToProfile(url: string): void {
    const profileId = URLParser.extractProfileId(url)
    const component = ComponentFactory.createProfilePage(profileId)
    this.updateHistoryAndView(url, component, 'profile')
  }

  /**
   * Navigate to a hashtag page
   */
  navigateToHashtag(url: string): void {
    const component = ComponentFactory.createHashtagPage()
    this.updateHistoryAndView(url, component, 'hashtag')
  }

  /**
   * Navigate to following list
   */
  navigateToFollowingList(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/following', ''))
    const component = ComponentFactory.createFollowingListPage(profileId)
    this.updateHistoryAndView(url, component, 'following')
  }

  /**
   * Navigate to mute list
   */
  navigateToMuteList(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/muted', ''))
    const component = ComponentFactory.createMuteListPage(profileId)
    this.updateHistoryAndView(url, component, 'mute')
  }

  /**
   * Navigate to others relay settings
   */
  navigateToOthersRelaySettings(url: string): void {
    const profileId = URLParser.extractProfileId(url.replace('/relays', ''))
    const component = ComponentFactory.createOthersRelaySettingsPage(profileId)
    this.updateHistoryAndView(url, component, 'others-relay-settings')
  }

  /**
   * Navigate to settings
   */
  navigateToSettings(url: string): void {
    if (URLParser.isSettingsSubPage(url)) {
      const subPageType = URLParser.getSettingsSubPageType(url)
      const component = ComponentFactory.createSettingsSubPage(subPageType)
      this.updateHistoryAndView(url, component, 'settings-sub')
    } else {
      const component = ComponentFactory.createSettingsPage()
      this.updateHistoryAndView(url, component, 'settings')
    }
  }

  /**
   * Get page title based on view type and URL
   */
  getPageTitle(viewType: ViewType, pathname: string): string {
    if (viewType === 'settings') return 'Settings'
    if (viewType === 'settings-sub') {
      if (pathname.includes('/general')) return 'General Settings'
      if (pathname.includes('/relays')) return 'Relays and Storage Settings'
      if (pathname.includes('/cache')) return 'Cache & offline storage'
      if (pathname.includes('/wallet')) return 'Wallet Settings'
      if (pathname.includes('/posts')) return 'Post Settings'
      if (pathname.includes('/translation')) return 'Translation Settings'
      return 'Settings'
    }
    if (viewType === 'profile') {
      if (pathname.includes('/following')) return 'Following'
      if (pathname.includes('/relays')) return 'Relays and Storage Settings'
      return 'Profile'
    }
    if (viewType === 'hashtag') return 'Hashtag'
    if (viewType === 'relay') return 'Relay'
    if (viewType === 'note') {
      // Try to get title from sessionStorage if NotePage has set it
      // NotePage will store the title when it determines the event kind
      const storedTitle = sessionStorage.getItem('notePageTitle')
      if (storedTitle) {
        sessionStorage.removeItem('notePageTitle') // Clean up after use
        return storedTitle
      }
      return 'Note'
    }
    if (viewType === 'following') return 'Following'
    if (viewType === 'mute') return 'Muted Users'
    if (viewType === 'others-relay-settings') return 'Relays and Storage Settings'
    return 'Page'
  }

  /**
   * Handle back navigation
   */
  handleBackNavigation(viewType: ViewType): void {
    if (viewType === 'settings-sub') {
      // Navigate back to main settings page
      this.navigateToSettings('/settings')
    } else {
      // Use browser's back functionality
      window.history.back()
    }
  }

  /**
   * Private helper to update history and view
   */
  private updateHistoryAndView(url: string, component: ReactNode, viewType: ViewType): void {
    window.history.pushState(null, '', url)
    this.context.setPrimaryNoteView(component, viewType)
  }
}

/**
 * Hook factory for creating navigation hooks
 */
export function createNavigationHook(service: NavigationService) {
  return {
    useSmartNoteNavigation: () => ({
      navigateToNote: (url: string) => service.navigateToNote(url)
    }),
    
    useSmartRelayNavigation: () => ({
      navigateToRelay: (url: string) => service.navigateToRelay(url)
    }),
    
    useSmartProfileNavigation: () => ({
      navigateToProfile: (url: string) => service.navigateToProfile(url)
    }),
    
    useSmartHashtagNavigation: () => ({
      navigateToHashtag: (url: string) => service.navigateToHashtag(url)
    }),
    
    useSmartFollowingListNavigation: () => ({
      navigateToFollowingList: (url: string) => service.navigateToFollowingList(url)
    }),
    
    useSmartMuteListNavigation: () => ({
      navigateToMuteList: (url: string) => service.navigateToMuteList(url)
    }),
    
    useSmartOthersRelaySettingsNavigation: () => ({
      navigateToOthersRelaySettings: (url: string) => service.navigateToOthersRelaySettings(url)
    }),
    
    useSmartSettingsNavigation: () => ({
      navigateToSettings: (url: string) => service.navigateToSettings(url)
    })
  }
}
