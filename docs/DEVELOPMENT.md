# 🛠️ Development Guide

This guide is for developers who want to contribute, fork, or deploy their own version of the extension.

## 📦 Project Structure

```
owlbear-gm-vault/
├── manifest.json              # Extension configuration
├── index.html                 # User interface
├── js/
│   └── index.js               # Main logic
├── css/
│   ├── app.css                # Application styles
│   └── notion-markdown.css    # Styles for rendering content
├── html/
│   └── image-viewer.html      # Image viewer modal
├── img/                       # Icons and images
├── icon.svg                   # Extension icon
├── netlify/
│   ├── functions/
│   │   ├── notion-api.js      # Netlify Function (secure proxy)
│   │   └── get-debug-mode.js  # Debug mode function
│   └── netlify.toml           # Netlify configuration
├── public/
│   └── default-config.json    # Default configuration
├── package.json               # Node.js configuration
├── .gitignore                 # Files ignored by Git
├── README.md                  # Public documentation
└── docs/
    ├── COMPLIANCE.md          # Extension compliance checklist
    ├── DEVELOPMENT.md         # Development guide (this file)
    └── USER_FEATURES.md       # Complete UI features guide for users
```

## 🚀 Deploy to Netlify

### Basic steps

1. **Fork/clone this repository**

2. **Create a Netlify account** (free)

3. **Connect your repository:**
   - "Add new site" → "Import an existing project"
   - Connect GitHub/GitLab → Select this repo

4. **Automatic deployment:**
   - Netlify will detect and deploy automatically
   - **You don't need to configure token** - each user will configure their own

5. **Share the URL:**
   - Example: `https://your-project.netlify.app/manifest.json`
   - Share this URL with users
   - **Each user will configure their own token** from the interface (🔑 button)

### Optional server token

If you want it to work without users configuring anything (shared pages):

1. **In Netlify Dashboard:**
   - Settings → Environment variables
   - Add: `NOTION_API_TOKEN` = `your_notion_token`
   - Get the token: https://www.notion.so/my-integrations

2. **In Notion:**
   - Share your pages with the integration
   - Users will see these pages without configuring anything

3. **Users can:**
   - Use shared pages (without token)
   - Or configure their own token (🔑) for their pages

## 🔧 Local Development

### Requirements

- Static web server (any works)
- Notion pages configured as private (shared with integration) or public

### Configuration

1. **Local server:**
   ```bash
   npm run serve
   ```

2. **Use in Owlbear:**
   - `http://127.0.0.1:8000/manifest.local.json`

3. **Configure your token:**
   - Open the extension in Owlbear
   - Click the **🔑** button (top right)
   - Paste your Notion token
   - Done! You can now use your pages

**Note:** Configuration is managed completely from the interface. You don't need local configuration files.

## 🧪 Test that it works

To test that the extension works:

1. **Open Owlbear Rodeo** and enter a room
2. **Open the extension** from the extensions menu
3. **Configure your token** by clicking the **🔑** button
4. **Add a page** from the interface
5. **Click on the page** to verify it loads correctly

**If there are errors:**
- **Invalid token:** Verify that the token is correct (must start with `secret_` or `ntn_`)
- **No permissions:** Make sure the Notion integration has access to the page
- **Page not found:** Verify that the URL is correct and that the page is shared with the integration

## 🔐 Security

**For Developers:**

- ✅ Token is stored in Netlify (environment variables) - optional
- ✅ Token is NEVER exposed to the client (uses Netlify Functions as proxy)
- ✅ End users configure their own token from the interface (🔑 button)
- ✅ User tokens are stored locally in the browser (localStorage)
- ✅ Server token is optional and only used if user token is not configured

**For Users:**

- ✅ You don't need to know anything about tokens
- ✅ Just use the extension normally
- ✅ Your token is stored locally and never sent to the server (except through secure Netlify Functions)

## 📚 Documentation

### User Documentation
- **[README.md](../README.md):** Main user guide with installation, usage, and troubleshooting
- **[USER_FEATURES.md](USER_FEATURES.md):** Complete guide to all UI features, buttons, and functionality

### Owlbear SDK

This extension uses the official Owlbear Rodeo SDK:
- [Documentation](https://docs.owlbear.rodeo/)
- [Modal API](https://docs.owlbear.rodeo/extensions/apis/modal/)

## 📝 Development Notes

- Notion pages can be **private** (they don't need to be public) if shared with the integration
- The modal opens with a responsive size
- You can have multiple pages configured
- The extension is completely private if you don't share it publicly
- **✅ Security:** Tokens are managed from the interface and stored locally (localStorage)

## 🔄 Content Sharing Architecture

### How it works

**Problem:** Room metadata has a 16KB size limit, but rendered Notion HTML can be much larger.

**Solution:** Use `OBR.broadcast` for real-time content sharing between GM and players.

**Flow:**
1. **GM loads a Notion page:**
   - Fetches blocks from Notion API (using GM's token)
   - Renders HTML from blocks
   - Stores rendered HTML in local memory cache (not room metadata)
   - Sets up broadcast listener to respond to player requests

2. **Player requests content:**
   - Player clicks on a visible page
   - Sends broadcast message: `BROADCAST_CHANNEL_REQUEST` with `pageId`
   - Shows "Waiting..." message while waiting for response

3. **GM responds:**
   - Receives broadcast request
   - Looks up HTML in local cache
   - Sends broadcast message: `BROADCAST_CHANNEL_RESPONSE` with `pageId` and `html`
   - Player receives HTML and displays it

**Key Components:**
- `localHtmlCache`: In-memory cache on GM side (max 20 pages)
- `requestHtmlFromGM()`: Player function to request content
- `setupGMContentBroadcast()`: GM listener for player requests
- `saveHtmlToLocalCache()`: GM function to cache rendered HTML

**Benefits:**
- No size limits (broadcast doesn't have 16KB limit)
- Real-time sharing (instant updates)
- No token required for players
- Works as long as GM has extension open

**Limitations:**
- GM must have extension open for sharing to work
- Content is not persisted (cleared when GM closes extension)
- 5-second timeout if GM doesn't respond

## 🗺️ Roadmap / Next Steps

### ✅ Implemented

- ✅ Text, headings (H1, H2, H3)
- ✅ Lists (bulleted, numbered, to-do)
- ✅ Toggle list and Toggle headings (H1, H2, H3)
- ✅ Images (clickable, full-size modal)
- ✅ Tables
- ✅ Columns (2, 3, 4, 5 columns)
- ✅ Code, Quote, Callout
- ✅ Divider
- ✅ Folder-based page management
- ✅ Move up/down reordering
- ✅ Import/Export JSON configuration
- ✅ User token management (global)
- ✅ Per-room configuration
- ✅ External URL support with CSS selectors
- ✅ Block type filtering (`blockTypes`)
- ✅ Nested folders (unlimited depth)
- ✅ Automatic page icons
- ✅ Cache management
- ✅ Debug mode (controlled by Netlify environment variable)
- ✅ **PDF support** embedded
- ✅ **Collapse/expand all folders** functionality
- ✅ **Settings panel** with unified configuration interface
- ✅ **Token integration** via context menu (link/view/unlink pages)
- ✅ **Player visibility control** - GM can control which pages are visible to players
- ✅ **Visibility toggle buttons** - Quick toggle buttons for pages and categories
- ✅ **Content sharing via broadcast** - GM shares Notion content with players (no token required)
- ✅ **Shared cache for Notion blocks** - Players can view Notion content without their own token
- ✅ **Empty state for players** - Shows message when GM hasn't shared content
- ✅ **Role-based UI** - Different interface for GM vs Player
- ✅ **Image sharing for players** - GM can share images via broadcast

### 🔜 Future Implementations

#### Multi-service support (branch `feature/multi-service`)
- **Status:** Code ready, disabled for soft launch
- **Services:** Google Drive, Docs, Sheets, Slides, Dropbox, OneDrive, YouTube, Vimeo, Figma
- **Description:** Automatic URL conversion to embed format
- **Branch:** `feature/multi-service`

#### Child Database (Nested databases)
- **Status:** Pending
- **Complexity:** Medium-High
- **Description:** Render complete databases that are inside a page
- **Requirements:**
  - Get database structure
  - Render rows and columns
  - Support for different property types (text, number, date, etc.)
  - Pagination if there are many rows

#### Block Equation (Mathematical formulas)
- **Status:** Pending
- **Complexity:** Medium
- **Description:** Render mathematical formulas using KaTeX or MathJax
- **Requirements:**
  - Integrate math rendering library
  - Parse Notion's LaTeX format

#### Synced Block (Synchronized blocks)
- **Status:** Pending
- **Complexity:** Medium
- **Description:** Render blocks that are synchronized between pages
- **Requirements:**
  - Detect synchronized blocks
  - Get content from the original block

## 📊 Project Statistics

### ⏱️ Development Time
- **Start date:** December 19, 2025
- **Last update:** January 2025
- **Active work days:** 8+ days
- **Total commits:** 250+ commits
- **Average commits per day:** ~28 commits/day
- **Most productive days:** 
  - Dec 21: 45 commits
  - Dec 20: 39 commits  
  - Dec 24: 37 commits
- **Most active hours:** 20:00-21:00 (intense night sessions)

### 📈 Code Metrics
- **Lines of code:** ~7,045 lines
- **Main files:** 17 files
- **Languages:** JavaScript (ES6+), HTML5, CSS3, JSON
- **Current version:** 2.0.1
- **Project size:** ~500 KB (without node_modules)

### 🎯 Project Scope
- **Type:** Extension for Owlbear Rodeo
- **Main functionality:** Notion integration
- **Supported content:** Notion, PDFs, external URLs
- **Implemented features:** 25+ main features
- **Notion blocks supported:** 15+ block types
- **Coming soon:** Multi-service (branch `feature/multi-service`)

### 🛠️ Technologies Used
- **Frontend:** Vanilla JavaScript (ES6+), HTML5, CSS3
- **Backend:** Netlify Functions (Node.js)
- **SDK:** Owlbear Rodeo SDK v3.1.0
- **APIs:** Notion API
- **Storage:** 
  - `localStorage` (user token, local cache)
  - `OBR.room.setMetadata()` (page configuration, shared blocks cache)
  - `OBR.broadcast` (real-time content sharing)
  - In-memory cache (GM's rendered HTML)
- **Deployment:** Netlify
- **Version control:** Git

## 🐛 Known Issues

Currently there are no known critical bugs. If you encounter any issues, please report them via GitHub Issues.

### Minor Limitations

- **Child Databases:** Nested databases are not yet supported (see Roadmap)
- **Block Equations:** Mathematical formulas are not yet rendered (see Roadmap)
- **Synced Blocks:** Synchronized blocks are not yet supported (see Roadmap)

## 🔓 Make a Notion page public

1. Open your page in Notion
2. Click "Share" (top right)
3. Enable "Share to web"
4. Copy the public URL
5. Paste it in the extension configuration
