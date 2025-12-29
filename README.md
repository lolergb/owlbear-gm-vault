# 📚 DM screen for Owlbear Rodeo

This is an [Owlbear Rodeo](https://www.owlbear.rodeo/) extension that allows you to embed Notion pages and external content directly in Owlbear Rodeo. It lets you share character sheets, additional documentation, and more with players, providing quick access to vital information and resources for everyone involved.

## ✨ Features

- 🎯 Open Notion pages in modals within Owlbear
- 📝 Page management by folders from the interface
- 🎨 Clean and dark interface
- 💾 Persistent cache for fast loading
- 🏠 Independent configuration per Owlbear room
- 🖼️ Full-size image viewing in modal
- 📥 Import/Export JSON configuration
- 🔑 User token management (global for all rooms)
- 🌐 Support for external URLs with CSS selectors
- 🎛️ Block type filtering for Notion pages
- 📊 Nested folders with unlimited depth
- 🎨 Automatic page icons from Notion
- 🗑️ Cache management (clear all or per page)
- 📄 **PDF support:** Any publicly accessible PDF file
- 📁 **Folder management:** Collapse/expand all folders, reorder items
- ⚙️ **Settings panel:** Unified configuration interface
- 🎯 **Token integration:** Link pages to scene tokens via context menu
- 👥 **Player visibility control:** GM can control which pages are visible to players
- 🔄 **Content sharing:** GM shares Notion content with players via broadcast (no token required for players)
- 👁️ **Visibility toggles:** Quick visibility buttons for pages and categories

## 🚀 Installation

The extension can be installed manually by pasting the manifest URL below in the "Add Extension" dialog.

```
https://owlbear-notion-embed.netlify.app/manifest.json
```

Or use the URL provided by the extension developer.

## 📖 How to use DM screen

### Initial setup

**Each user uses their own Notion account!** You only need to configure your token once.

#### 1. Get your Notion token

**Step 1: Create the integration**
1. Go to https://www.notion.so/my-integrations
2. Click **"+ New integration"**
3. Give it a name (e.g., "Owlbear Notion")
4. Select your workspace
5. Click **"Submit"**

**Step 2: Copy the token**
1. On the integration page, find **"Internal Integration Token"**
2. Click **"Show"** and copy the token (starts with `secret_`)

**Step 3: Share your pages**
1. In Notion, open each page you want to use
2. Click **"Share"** (top right)
3. Find your integration name and give it access

**Step 4: Configure in the extension**
1. In the extension: **🔑** → Paste the token → **Save**
2. Done! You can now use your pages

### Daily usage

1. **Open Owlbear Rodeo** and enter your game room
2. **Open the extension** from the extensions menu (icon in the top bar)
3. **You'll see a list** of Notion pages organized by categories
4. **Click on a page** to open it and view its content
5. **Use the ← Back button** to return to the list

### Manage your pages

**Each room has its own configuration:**

1. Click the **⚙️** button (top right) to open Settings
2. From the main view, you can:
   - Click **➕** to add new folders or pages
   - Use the **⋯** menu on any item to:
     - Edit name and URL
     - Move up/down to reorder
     - Delete items
   - Click on folders to collapse/expand them
   - Use the **📁** button to collapse/expand all folders at once
3. In Settings, you can:
   - Configure your Notion token
   - View current JSON configuration
   - Load JSON from file
   - Download JSON configuration

### JSON configuration structure

```json
{
  "categories": [
    {
      "name": "Folder name",
      "pages": [
        {
          "name": "Page name",
          "url": "Page URL",
          "selector": "optional-selector",
          "blockTypes": ["optional", "block", "types"],
          "visibleToPlayers": false
        }
      ],
      "categories": [
        {
          "name": "Subfolder",
          "pages": [
            {
              "name": "Page in subfolder",
              "url": "Page URL",
              "visibleToPlayers": true
            }
          ]
        }
      ]
    }
  ]
}
```

#### Configuration properties

**Folders (`categories`)**
- **Type:** Array of objects
- **Required:** Yes
- **Description:** List of folders that group pages

**Pages (`categories[].pages`)**
- **Type:** Array of objects
- **Required:** No (optional if there are subfolders)
- **Description:** List of pages within the folder

**Subfolders (`categories[].categories`)**
- **Type:** Array of objects
- **Required:** No (optional)
- **Description:** List of nested subfolders within the folder
- **Note:** Subfolders can have their own pages and subfolders (unlimited nesting)

**Page (`categories[].pages[].name`)**
- **Type:** String
- **Required:** Yes
- **Description:** Name displayed on the page button

**Page (`categories[].pages[].url`)**
- **Type:** String (URL)
- **Required:** Yes
- **Description:** Complete page URL.
- **Examples:**
  - Notion: `https://your-workspace.notion.site/Title-2d0d4856c90e80f6801dcafb6b7366e6`
  - PDF: `https://example.com/document.pdf`
  - External URL: `https://5e.tools/book.html#mm,1`

**Page (`categories[].pages[].selector`)**
- **Type:** String (CSS selector)
- **Required:** No (optional)
- **Description:** CSS selector (ID or class) to load only a specific element from the page
- **When to use:** Only for URLs that are NOT from Notion (external URLs)
- **Examples:**
  - By ID: `"#main-content"`
  - By class: `".article-body"`

**Page (`categories[].pages[].blockTypes`)**
- **Type:** String or Array of strings
- **Required:** No (optional)
- **Description:** Block type filter to show only certain types of content in Notion pages
- **When to use:** Only for Notion URLs (ignored in external URLs)
- **Examples:**
  - Single type: `"quote"` (only show quotes)
  - Multiple types: `["quote", "callout"]` (only show quotes and callouts)

**Page (`categories[].pages[].visibleToPlayers`)**
- **Type:** Boolean
- **Required:** No (defaults to `false`)
- **Description:** Whether this page is visible to players. Only the GM can see pages with `visibleToPlayers: false`
- **When to use:** Set to `true` to allow players to view the page
- **Note:** Players cannot see pages unless explicitly marked as visible by the GM

### Update content

- **Automatic reload:** Content is cached for fast loading
- **🔄 Button:** Forces reload of a specific page (useful if you updated Notion)
- **Cache management:** Available in the Settings panel

### Token integration

You can link pages directly to tokens/characters in the scene:

1. **Right-click on any token** in the scene
2. Select **"Link page"**
3. Choose a page from your configuration
4. The page is now linked to that token

**To view a linked page:**
- Right-click on the token → **"View linked page"**

**To unlink:**
- Right-click on the token → **"Unlink page"** - GM only

**Note:** Only the GM can link/unlink pages. All players can view linked pages.

### Player visibility and content sharing

**By default, all pages are hidden from players.** The GM must explicitly mark pages as visible for players to see them.

#### For Game Masters (GM)

**Control page visibility:**
1. **Toggle page visibility:** Click the **👁️** button next to any page to show/hide it from players
2. **Toggle category visibility:** Click the **👁️** button next to any folder to show/hide all pages in that folder (and subfolders)
3. **Page header toggle:** When viewing a page, use the **👁️** button in the header to toggle visibility
4. **Image sharing:** When viewing an image, click **"Show to players"** to share it with all players

**How content sharing works:**
- When the GM views a Notion page, the rendered HTML is cached locally
- Players can request this content via broadcast (no Notion token required)
- The GM automatically responds with the cached content
- Players see the exact same rendered content as the GM

**Important:**
- The GM must have the extension open to share content with players
- Players will see a "Waiting for the GM to load this content..." message if the GM hasn't viewed the page yet
- Players can click "Retry" to request content again

#### For Players

**What you can see:**
- Only pages marked as visible by the GM
- Content shared by the GM (no Notion token required)
- Images shared by the GM via the image viewer

**What you cannot do:**
- Add, edit, or delete pages or folders
- Change page visibility
- Access settings
- View pages that the GM hasn't marked as visible

**Empty state:**
- If the GM hasn't shared any content, you'll see: "No shared pages - The DM hasn't shared any pages with you yet"

### Supported content

- **Notion pages** - Private or public pages (shared with your integration)
- **PDFs** - Any publicly accessible PDF file
- **External URLs** - Any web page (with optional CSS selectors)

### 💡 Tips

- **Each user has their own token:** Configure your token once and use it in all rooms
- **Each room is independent:** Pages are configured per room, but the token is shared
- **Private token:** Your token is stored locally in your browser, only you can see it
- **Notion URLs:** You can use private pages (they don't need to be public) if you share them with your integration
- **Icons:** Pages automatically show their Notion icon
- **Images:** Click on any image to view it at full size
- **Change token:** Click **🔑** → Delete Token to go back to using the server token (if configured)
- **Player visibility:** By default, all pages are hidden from players. Use the **👁️** button to make pages visible
- **Content sharing:** Players don't need a Notion token to view pages shared by the GM
- **GM must be online:** The GM needs to have the extension open for players to receive shared content

## 🐛 Troubleshooting

**Page doesn't open:**
- Verify that the Notion URL is correct
- Make sure the URL is complete (without `?source=...` parameters)
- Check that the page is shared with your integration

**External content doesn't load:**
- For PDFs: Make sure the URL is publicly accessible
- For external URLs: Some pages block iframes for security (CORS)
- Check the browser console for CORS or iframe errors

**Extension doesn't appear:**
- Verify that `manifest.json` is publicly accessible
- Check that the manifest URL is correct in Owlbear

**Token error:**
- Verify that your token is correct (starts with `secret_` or `ntn_`)
- Make sure the integration has access to the pages you're trying to view

**Cache issues:**
- Use the 🔄 button to reload a specific page
- Use the 🗑️ button to clear all cache

**Player can't see pages:**
- Make sure the GM has marked the page as visible (👁️ button should show eye-open icon)
- Verify the GM has the extension open (required for content sharing)
- Player should see "Waiting for the GM to load this content..." if the GM hasn't viewed the page yet
- Player can click "Retry" to request content again

**Content not loading for players:**
- GM must view the page first to cache the content
- GM must have the extension open for broadcast to work
- Check browser console for broadcast errors

## 💬 Support

### Getting help

If you encounter any issues, have questions, or want to request a feature:

1. **Check the README:** Most common questions are answered in this document
2. **Check the troubleshooting section:** See above for common issues and solutions
3. **GitHub Issues:** Open an issue on [GitHub](https://github.com/lolergb/owlbear-notion-embed/issues) for:
   - Bug reports
   - Feature requests
   - Usage questions
4. **GitHub Discussions:** Use [GitHub Discussions](https://github.com/lolergb/owlbear-notion-embed/discussions) for:
   - General questions
   - Sharing configurations
   - Community support

### Reporting bugs

When reporting a bug, please include:
- **Description:** What happened vs. what you expected
- **Steps to reproduce:** How to trigger the issue
- **Browser/OS:** Your browser and operating system
- **Console errors:** Any errors visible in the browser console (F12)
- **Extension version:** Check the version in manifest.json

## 📄 License

Personal use - Feel free to modify and use as you wish.
