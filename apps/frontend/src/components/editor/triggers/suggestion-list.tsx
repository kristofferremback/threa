/**
 * Common interface for suggestion list keyboard handling.
 * Each list component (MentionList, ChannelList, CommandList) implements this.
 */
export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}
