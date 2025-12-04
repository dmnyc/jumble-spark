# Citation Test Content Guide

## File: `CITATION_TEST_CONTENT.adoc`

This file contains comprehensive test examples for embedding all citation types in AsciiDoc articles.

## Citation Format

All citations use plain format (passthrough markers are added automatically during processing):

```
[[citation::TYPE::NEVENT_ID]]
```

## Citation Types Tested

### 1. Internal Citations (Kind 30)
- `inline` - Inline citation within text
- `foot` - Footnote citation
- `end` - Endnote in references section
- `quote` - Block-level citation card

### 2. External Web Citations (Kind 31)
- `inline` - Inline citation
- `foot-end` - Footnote linking to endnote
- `end` - Endnote in references

### 3. Hardcopy Citations (Kind 32)
- `inline` - Inline citation
- `end` - Endnote in references
- `quote` - Block-level citation card

### 4. Prompt Citations (Kind 33)
- `prompt-inline` - Inline prompt citation
- `prompt-end` - Prompt citation in references section

## How to Use

1. **Create Citation Events**: Use the Post Editor to create citations:
   - Internal Citation (kind 30)
   - External Citation (kind 31)
   - Hardcopy Citation (kind 32)
   - Prompt Citation (kind 33)

2. **Get Citation IDs**: After creating citations, copy their nevent IDs (or note IDs)

3. **Replace Placeholders**: In the test document, replace all `nevent1qq...` placeholder IDs with your actual citation event IDs

4. **Test in Article**: 
   - Create a new AsciiDoc article (kind 30818) or Wiki Article (kind 30817)
   - Paste the test content (with real citation IDs)
   - Publish and verify all citation types render correctly

## Citation Display Types

- **inline** / **prompt-inline**: Renders as clickable text inline
- **foot**: Creates superscript footnote numbers
- **foot-end**: Creates footnotes that link to endnotes
- **end** / **prompt-end**: Appears in References section at end
- **quote**: Block-level citation card for emphasis

## Testing Checklist

- [ ] Internal citations render inline
- [ ] Internal citations render as footnotes
- [ ] Internal citations appear in references section
- [ ] External citations render correctly
- [ ] Hardcopy citations render correctly
- [ ] Prompt citations render correctly (inline and end)
- [ ] Block quote citations display as cards
- [ ] Mixed citations in same paragraph work
- [ ] All citation types are clickable and navigate correctly

## Notes

- Citation IDs can be in format: `nevent1...`, `note1...`, or hex IDs
- All citations must exist on your Nostr relays to render properly
- Endnotes automatically collect at the end in a "References" section
- Footnotes appear at the bottom of the page/section

