# User Interface Features Guide

This document lists all the features available to users from the interface, what they do, and where they are explained in the documentation.

## 📋 Table of Contents

1. [Main Interface Buttons](#main-interface-buttons)
2. [Page Management](#page-management)
3. [Folder Management](#folder-management)
4. [Settings Panel](#settings-panel)
5. [Page Viewing Features](#page-viewing-features)
6. [Token Integration](#token-integration)
7. [Player Visibility Controls](#player-visibility-controls)
8. [Content Sharing](#content-sharing)

---

## Main Interface Buttons

### ⚙️ Settings Button
- **Location:** Top right corner of the main interface
- **What it does:** Opens the Settings panel where you can configure your Notion token, view JSON configuration, and manage cache
- **Documentation:** Explained in [README.md - Initial setup](../README.md#initial-setup) and [README.md - Manage your pages](../README.md#manage-your-pages)

### ➕ Add Button
- **Location:** Top right corner, next to Settings button
- **What it does:** Opens a menu to add a new folder or page to your configuration
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages)

### 📁 Collapse/Expand All Folders Button
- **Location:** Top right corner, next to Add button
- **What it does:** Collapses or expands all folders at once
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages)

### ← Back Button
- **Location:** Top left corner (appears when viewing a page)
- **What it does:** Returns you to the main page list
- **Documentation:** Explained in [README.md - Daily usage](../README.md#daily-usage)

---

## Page Management

### Clicking on a Page
- **Location:** Main page list
- **What it does:** Opens the page content in a modal view
- **Documentation:** Explained in [README.md - Daily usage](../README.md#daily-usage)

### 👁️ Page Visibility Toggle Button
- **Location:** Right side of each page button (appears on hover)
- **What it does:** Shows or hides the page from players. Eye open = visible to players, eye closed = hidden from players
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

### ⋯ Page Context Menu Button
- **Location:** Right side of each page button (appears on hover)
- **What it does:** Opens a menu with options to:
  - **Edit:** Change the page name and URL
  - **Move up:** Move the page up in the list
  - **Move down:** Move the page down in the list
  - **Delete:** Remove the page from the configuration
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages)

---

## Folder Management

### Clicking on a Folder Title
- **Location:** Folder title bar
- **What it does:** Expands or collapses the folder to show/hide its contents
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages)

### 👁️ Folder Visibility Toggle Button
- **Location:** Right side of folder title (appears on hover)
- **What it does:** Shows or hides all pages in the folder (and subfolders) from players
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

### ⋯ Folder Context Menu Button
- **Location:** Right side of folder title (appears on hover)
- **What it does:** Opens a menu with options to:
  - **Add folder:** Create a new subfolder inside this folder
  - **Add page:** Add a new page to this folder
  - **Edit:** Change the folder name
  - **Move up:** Move the folder up in the list
  - **Move down:** Move the folder down in the list
  - **Delete:** Remove the folder and all its contents
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages)

---

## Settings Panel

### 🔑 Notion Token Configuration
- **Location:** Settings panel → Token section
- **What it does:** 
  - **Input field:** Paste your Notion integration token here
  - **Save Token button:** Saves your token (stored locally in your browser)
  - **Delete Token button:** Removes your token and switches back to server token (if available)
- **Documentation:** Explained in [README.md - Initial setup](../README.md#initial-setup) and [README.md - Tips](../README.md#-tips)

### 📄 JSON Configuration
- **Location:** Settings panel → JSON Configuration section
- **What it does:**
  - **View JSON button:** Shows your current configuration in JSON format
  - **Load JSON button:** Lets you upload a JSON file to import configuration
  - **Download JSON button:** Downloads your current configuration as a JSON file
- **Documentation:** Explained in [README.md - Manage your pages](../README.md#manage-your-pages) and [README.md - JSON configuration structure](../README.md#json-configuration-structure)

---

## Page Viewing Features

### 🔄 Reload Button
- **Location:** Top right corner when viewing a page (appears on hover over page title)
- **What it does:** Forces a reload of the page content (useful if you updated the page in Notion)
- **Documentation:** Explained in [README.md - Update content](../README.md#update-content)

### 👁️ Visibility Toggle in Page Header
- **Location:** Top right corner when viewing a page
- **What it does:** Toggles visibility of the current page for players
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

### Clicking on Images
- **Location:** Anywhere in a Notion page
- **What it does:** Opens the image in full-size modal viewer
- **Documentation:** Explained in [README.md - Features](../README.md#-features) and [README.md - Tips](../README.md#-tips)

### "Show to players" Button (on Images)
- **Location:** Image viewer modal
- **What it does:** Shares the image with all players via broadcast
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

---

## Token Integration

### Right-Click Menu on Tokens
- **Location:** Right-click on any token/character in the Owlbear scene
- **What it does:** Shows context menu options:
  - **Link page:** (GM only) Links a page from your configuration to the token
  - **View linked page:** Opens the page linked to this token
  - **Unlink page:** (GM only) Removes the link between token and page
- **Documentation:** Explained in [README.md - Token integration](../README.md#token-integration)

---

## Player Visibility Controls

### For Game Masters (GM)

#### Page Visibility Toggle
- **Location:** Next to each page button (👁️ icon)
- **What it does:** Controls whether players can see this specific page
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

#### Folder Visibility Toggle
- **Location:** Next to each folder title (👁️ icon)
- **What it does:** Controls visibility of all pages in the folder and subfolders
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

### For Players

#### Viewing Shared Pages
- **Location:** Main page list
- **What it does:** Players can only see pages marked as visible by the GM
- **Documentation:** Explained in [README.md - For Players](../README.md#for-players)

#### "Waiting for GM" Message
- **Location:** When clicking on a visible page
- **What it does:** Shows a message if the GM hasn't loaded the page yet, with a "Retry" button
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

---

## Content Sharing

### Automatic Content Sharing
- **How it works:** When the GM views a Notion page, the content is automatically cached and can be shared with players via broadcast
- **What players see:** Players see the exact same rendered content as the GM, without needing their own Notion token
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

### Image Sharing
- **Location:** Image viewer modal
- **What it does:** GM can click "Show to players" to share images with all players
- **Documentation:** Explained in [README.md - Player visibility and content sharing](../README.md#player-visibility-and-content-sharing)

---

## Supported Content Types

### Notion Pages
- **What it does:** Displays Notion pages (private or public, shared with your integration)
- **Documentation:** Explained in [README.md - Supported content](../README.md#supported-content)

### PDF Files
- **What it does:** Embeds publicly accessible PDF files
- **Documentation:** Explained in [README.md - Supported content](../README.md#supported-content)

### External URLs
- **What it does:** Displays external web pages (with optional CSS selectors to show only specific parts)
- **Documentation:** Explained in [README.md - Supported content](../README.md#supported-content) and [README.md - JSON configuration structure](../README.md#json-configuration-structure)

---

## Additional Features

### Automatic Page Icons
- **What it does:** Pages automatically display their Notion icon
- **Documentation:** Explained in [README.md - Tips](../README.md#-tips)

### Nested Folders
- **What it does:** Folders can contain subfolders with unlimited nesting depth
- **Documentation:** Explained in [README.md - Features](../README.md#-features) and [README.md - JSON configuration structure](../README.md#json-configuration-structure)

### Persistent Cache
- **What it does:** Content is cached for fast loading. Use the reload button to refresh if content is updated
- **Documentation:** Explained in [README.md - Features](../README.md#-features) and [README.md - Update content](../README.md#update-content)

### Per-Room Configuration
- **What it does:** Each Owlbear room has its own page configuration, but the Notion token is shared across all rooms
- **Documentation:** Explained in [README.md - Tips](../README.md#-tips)

---

## Quick Reference

| Feature | Location | Documentation Section |
|---------|----------|----------------------|
| Add folder/page | ➕ button (top right) | [Manage your pages](../README.md#manage-your-pages) |
| Settings | ⚙️ button (top right) | [Initial setup](../README.md#initial-setup) |
| Collapse folders | 📁 button (top right) | [Manage your pages](../README.md#manage-your-pages) |
| Edit page/folder | ⋯ menu on item | [Manage your pages](../README.md#manage-your-pages) |
| Toggle visibility | 👁️ button on item | [Player visibility](../README.md#player-visibility-and-content-sharing) |
| Reload page | 🔄 button when viewing | [Update content](../README.md#update-content) |
| Link to token | Right-click token → Link page | [Token integration](../README.md#token-integration) |
| View image full-size | Click any image | [Features](../README.md#-features) |

---

## Notes

- **GM vs Player:** Some features are only available to Game Masters (GM). Players have limited access and can only view content shared by the GM.
- **Token Required:** You need to configure your Notion token once to use your own pages. This is done in Settings (⚙️ button).
- **Room Independence:** Each Owlbear room has its own page configuration, but your token is shared across all rooms.
- **Content Sharing:** Players don't need a Notion token to view pages shared by the GM. The GM must have the extension open for sharing to work.

For more detailed information, please refer to the [main README.md](../README.md) file.

