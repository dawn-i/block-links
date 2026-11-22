# Who dat link?

## about

This Obsidian plugin shows a small `↩ N` badge on linked headings and blocks. Click the badge to interact with a list of the incoming links. A `Rename` button renames the destination and keeps the links connected.

Why: Avoid accidentally breaking links when renaming in the editor, and save time from having to search to identify or back-follow the links.

## status

Fully functional 0.0.1

In a testing cohort of one, it's a success, so far.

## what's in the box

### features

- Block and heading link badges with count.
- Popover with incoming links list.
- Convenient renaming.

### features maybe?

- make it more apparent when a link is in a property
- make it more apparent when a link is embedded link
- abide by Obsidian's modifier-key behavior when cliking links in popover
- group links by source note, and make groups collapsible
- allow `Ctrl` *+ hover* display of links in popover per the user's `Settings > Page preview > Editing view` setting
- support Reading view
- track footnotes
- add a pair of classes to distinguish a heading badge from a block badge
- write a little how-to on styling the CSS selectors, in lieu of adding styling options to settings

### features for sure (roadmap)

- provide keyboard access and navigation in popover 

### features contingent

If publishing to community directly, gonna want to:
- name the plugin for real
- ask devs on OMG if anyone has a more stable way to take advantage of Obsidian's internal rename process or even a just more reliable way to open the context menu and select the two commands
- (if the above is negative, then) Detect UI language, or make it easy for the user to enter their UI language's translation of `Rename this heading...` and `Rename this block ID...`
- test in Canvas, where file cards can link to note headings

### features launched

- 0.0.1
	- Editor displays numbered badges
	- Popover shows clickable list of incoming links with a small amount of text context
	- Links in properties display without excess context
	- A button opens Obsidian's rename modal: yay!, but future fragile, undocumented, relies on the menu item's string in the user's selected language
	- CSS has style 😎
		- Badge stands out when cursor is in position to break a link by typing
		- Badge is more inconspicuous when cursor is not interacting with the line

## license

MIT