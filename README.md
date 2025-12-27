# 📚 Notion Embed for Owlbear Rodeo

Simple extension to embed Notion pages directly in Owlbear Rodeo.

## ✨ Features

- 🎯 Open Notion pages in modals within Owlbear
- 📝 Page management by categories from the interface
- 🎨 Clean and dark interface
- 💾 Persistent cache for fast loading
- 🏠 Independent configuration per Owlbear room
- 🖼️ Full-size image viewing in modal
- 🔄 Visual editor for managing pages and categories
- 📥 Import/Export JSON configuration
- 🔑 User token management (global for all rooms)
- 🌐 Support for external URLs with CSS selectors
- 🎛️ Block type filtering for Notion pages
- 📊 Nested categories with unlimited depth
- 🎨 Automatic page icons from Notion
- 🗑️ Cache management (clear all or per page)

---

## 👥 For DMs (End Users)

**Each user uses their own Notion account!** You only need to configure your token once.

### 🚀 Installation (One-time)

1. **Get the extension URL** from the developer
   - Example: `https://your-project.netlify.app/manifest.json`

2. **In Owlbear Rodeo:**
   - Go to your profile → "Add Extension"
   - Paste the `manifest.json` URL
   - Install

3. **Configure your Notion token:**
   - Open the extension
   - Click on **🔑** (top right)
   - Follow the on-screen instructions
   - **Done!** You can now use your Notion pages

### 🔑 Get your Notion Token

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

### 📖 Daily Usage

1. **Open Owlbear Rodeo** and enter your game room
2. **Open the extension** from the extensions menu (icon in the top bar)
3. **You'll see a list** of Notion pages organized by categories
4. **Click on a page** to open it and view its content
5. **Use the ← Back button** to return to the list

### 📝 Manage your pages

**Each room has its own configuration:**

1. Click the **⚙️** button (top right)
2. A visual editor opens where you can:
   - Add new pages
   - Create new categories
   - Edit names and URLs
   - Delete pages and categories
   - Reorder items by drag and drop
   - Import/Export JSON configuration
3. Click **"Save"** to apply changes
4. Click **"Reset"** if you want to return to the default configuration

**JSON Configuration Structure:**

```json
{
  "categories": [
    {
      "name": "Category name",
      "pages": [
        {
          "name": "Page name",
          "url": "Page URL",
          "selector": "optional-selector",
          "blockTypes": ["optional", "block", "types"]
        }
      ],
      "categories": [
        {
          "name": "Subcategory",
          "pages": [
            {
              "name": "Page in subcategory",
              "url": "Page URL"
            }
          ]
        }
      ]
    }
  ]
}
```

**Configuration Properties:**

#### Categories (`categories`)
- **Type:** Array of objects
- **Required:** Yes
- **Description:** List of categories that group pages

#### Category (`categories[].name`)
- **Type:** String
- **Required:** Yes
- **Description:** Category name (displayed as title)

#### Pages (`categories[].pages`)
- **Type:** Array of objects
- **Required:** No (optional if there are subcategories)
- **Description:** List of pages within the category

#### Subcategories (`categories[].categories`)
- **Type:** Array of objects
- **Required:** No (optional)
- **Description:** List of nested subcategories within the category
- **Note:** Subcategories can have their own pages and subcategories (unlimited nesting)

#### Page (`categories[].pages[].name`)
- **Type:** String
- **Required:** Yes
- **Description:** Name displayed on the page button

#### Page (`categories[].pages[].url`)
- **Type:** String (URL)
- **Required:** Yes
- **Description:** Complete page URL
- **Examples:**
  - Notion: `https://your-workspace.notion.site/Title-2d0d4856c90e80f6801dcafb6b7366e6`
  - Notion (www): `https://www.notion.so/Title-2d0d4856c90e80f6801dcafb6b7366e6`
  - External: `https://5e.tools/book.html#mm,1`

#### Page (`categories[].pages[].selector`)
- **Type:** String (CSS selector)
- **Required:** No (optional)
- **Description:** CSS selector (ID or class) to load only a specific element from the page
- **When to use:** Only for URLs that are NOT from Notion (external URLs)
- **Examples:**
  - By ID: `"#main-content"`
  - By class: `".article-body"`
  - By selector: `"div.container > section.content"`
- **Note:** If omitted, the entire page is loaded. If provided, only the selected element is shown (useful for external pages where you only want to show a specific section)

#### Page (`categories[].pages[].blockTypes`)
- **Type:** String or Array of strings
- **Required:** No (optional)
- **Description:** Block type filter to show only certain types of content in Notion pages
- **When to use:** Only for Notion URLs (ignored in external URLs)
- **Examples:**
  - Single type: `"quote"` (only show quotes)
  - Multiple types: `["quote", "callout"]` (only show quotes and callouts)
- **Available block types:**
  - `paragraph`, `heading_1`, `heading_2`, `heading_3`, `bulleted_list_item`, `numbered_list_item`
  - `to_do`, `toggle`, `toggle_heading_1`, `toggle_heading_2`, `toggle_heading_3`
  - `code`, `quote`, `callout`, `divider`, `image`, `table`, `column_list`, `column`
- **Note:** If omitted, all blocks are shown. If provided, only blocks of the specified types are shown (useful for creating filtered views of a page, e.g., only quotes or only callouts)

**Complete example with all options:**

```json
{
  "categories": [
    {
      "name": "Adventures",
      "pages": [
        {
          "name": "My First Adventure",
          "url": "https://your-workspace.notion.site/My-First-Adventure-2d0d4856c90e80f6801dcafb6b7366e6"
        }
      ],
      "categories": [
        {
          "name": "Short",
          "pages": [
            {
              "name": "Random Encounters",
              "url": "https://www.notion.so/Random-Encounters-3e1e5967d01e91f7912ec8bf7c8477f8"
            }
          ]
        },
        {
          "name": "Long",
          "pages": [
            {
              "name": "Important NPCs",
              "url": "https://your-workspace.notion.site/Important-NPCs-4f2f6078e02e02f8023fd9cf8d9589f9"
            }
          ]
        }
      ]
    },
    {
      "name": "External References",
      "pages": [
        {
          "name": "D&D 5e Manual",
          "url": "https://5e.tools/book.html#mm,1",
          "selector": "#content"
        },
        {
          "name": "Rules Wiki",
          "url": "https://example.com/wiki/rules",
          "selector": ".main-article"
        },
        {
          "name": "Damage Calculator",
          "url": "https://calculator.com/damage",
          "selector": "#calculator-container"
        },
        {
          "name": "Full Page (no selector)",
          "url": "https://example.com/full-page"
        }
      ]
    },
    {
      "name": "Tokens and Maps",
      "pages": [
        {
          "name": "Token Collection",
          "url": "https://your-workspace.notion.site/Tokens-5a3a7189f03e03f9034ge0df0e0690a0"
        },
        {
          "name": "Battle Maps",
          "url": "https://www.notion.so/Battle-Maps-6b4b8290g14f14g0145ih1ef1f17a1b1"
        }
      ]
    },
    {
      "name": "Session Notes",
      "pages": [
        {
          "name": "Session 1 - Introduction",
          "url": "https://your-workspace.notion.site/Session-1-7c5c93a1h25g25h1256ji2fg2g28b2c2"
        },
        {
          "name": "Session 2 - The Forest",
          "url": "https://your-workspace.notion.site/Session-2-8d6d04b2i36h36i2367kj3gh3h39c3d3"
        }
      ]
    },
    {
      "name": "Filtered Views",
      "pages": [
        {
          "name": "Only Quotes",
          "url": "https://your-workspace.notion.site/My-Page-abc123",
          "blockTypes": "quote"
        },
        {
          "name": "Quotes and Callouts",
          "url": "https://your-workspace.notion.site/My-Page-abc123",
          "blockTypes": ["quote", "callout"]
        },
        {
          "name": "Only Headings",
          "url": "https://your-workspace.notion.site/My-Page-abc123",
          "blockTypes": ["heading_1", "heading_2", "heading_3"]
        }
      ]
    }
  ]
}
```

**Minimum example (one category, one page):**

```json
{
  "categories": [
    {
      "name": "General",
      "pages": [
        {
          "name": "My Page",
          "url": "https://your-notion.notion.site/My-Page-2d0d4856c90e80f6801dcafb6b7366e6"
        }
      ]
    }
  ]
}
```

**Important notes:**
- Categories and pages are displayed in the same order as in the JSON (no automatic sorting)
- Subcategories are displayed with visual indentation to indicate hierarchy
- Each category and subcategory can be collapsed/expanded independently
- `selector` only works with external URLs (non-Notion)
- `blockTypes` only works with Notion URLs (ignored in external URLs)
- For Notion pages, `selector` is ignored (Notion API is used)
- For external URLs, `blockTypes` is ignored (only applies to Notion)
- Page icons are automatically loaded from Notion
- You can nest subcategories to any level (unlimited depth)
- Use `blockTypes` to create filtered views of a page (e.g., only quotes, only callouts, etc.)

### 🔄 Update content

- **Automatic reload:** Content is cached for fast loading
- **🔄 Button:** Forces reload of a specific page (useful if you updated Notion)
- **🗑️ Button:** Clears all cache (useful if something doesn't update)

### 💡 Tips

- **Each user has their own token:** Configure your token once and use it in all rooms
- **Each room is independent:** Pages are configured per room, but the token is shared
- **Private token:** Your token is stored locally in your browser, only you can see it
- **Notion URLs:** You can use private pages (they don't need to be public) if you share them with your integration
- **Icons:** Pages automatically show their Notion icon
- **Images:** Click on any image to view it at full size
- **Change token:** Click **🔑** → Delete Token to go back to using the server token (if configured)

---

## 🛠️ For Developers (Deployment Only)

> **⚠️ This section is ONLY for whoever deploys the extension. End users do NOT need to do this.**

### 🚀 Deploy to Netlify

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

### 🔧 Optional Server Token

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

### 📝 Configure initial pages (Optional)

Pages can be managed from the interface, but you can configure initial pages by editing `build-config.js`:

```javascript
export const NOTION_PAGES = [
  {
    name: "My Adventure",
    url: "https://your-notion.notion.site/My-Adventure-..."
  }
];
```

### 🔧 Local Development

1. **Copy the example file:**
   ```bash
   cp config/config.example.js config/config.js
   ```

2. **Edit `config/config.js`** and add your token (only for local development):
   ```javascript
   export const NOTION_API_TOKEN = "your_notion_token_here";
   ```

3. **Local server:**
   ```bash
   npm run serve
   # or
   npx http-server -p 8000
   ```

4. **Use in Owlbear:**
   - `http://localhost:8000/manifest.json`

#### For GitHub Pages

GitHub Pages only serves static files, so you can't use environment variables directly. Options:

- **Option A (Simple - Development only):**
  - Keep `config.js` local and don't upload it to GitHub (already in `.gitignore`)
  - ⚠️ **Warning:** If someone accesses your site, the token will be visible in the client code

- **Option B (Secure - Requires GitHub Actions):**
  - Create a GitHub Actions workflow
  - Use GitHub Secrets to store the token
  - The workflow generates `config.js` at build time
  - See example in `.github/workflows/deploy.yml` (create if necessary)

### 🔓 Make a Notion page public

1. Open your page in Notion
2. Click "Share" (top right)
3. Enable "Share to web"
4. Copy the public URL
5. Paste it in the extension configuration

## 📦 Project Structure

```
owlbear-notion-embed/
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
├── config/
│   ├── config.example.js      # Configuration template
│   └── config.js              # Local configuration (gitignored)
├── scripts/
│   ├── build-config.js        # Build script for Netlify
│   └── test-notion-api.js     # Test script (development)
├── netlify/
│   ├── functions/
│   │   ├── notion-api.js      # Netlify Function (secure proxy)
│   │   └── get-debug-mode.js  # Debug mode function
│   └── netlify.toml           # Netlify configuration
├── public/
│   └── default-config.json    # Default configuration
├── package.json               # Node.js configuration
├── .gitignore                 # Files ignored by Git
└── README.md                  # This documentation
```

## 🧪 Test that it works

Before using the extension, verify that the Notion API is configured correctly:

```bash
# Run the test script
npm test
# or directly:
node scripts/test-notion-api.js
```

The script will verify:
- ✅ That `config.js` exists and has the token configured
- ✅ That the token is valid
- ✅ That it can access the configured pages
- ✅ That it gets blocks correctly

**If there are errors:**
- **Invalid token:** Verify that the token is correct in `config.js`
- **No permissions:** Make sure the Notion integration has access to the pages
- **Page not found:** Verify that the URLs in `config.js` are correct

## 🎮 Usage

1. **Open Owlbear Rodeo** and create/open a room
2. **Select the extension** from the extensions menu
3. **Click on a page** to open it in a modal
4. **Navigate** through your Notion content without leaving Owlbear

## 🔧 Development

### Requirements

- Static web server (any works)
- Notion pages configured as private (shared with integration) or public

### Owlbear SDK

This extension uses the official Owlbear Rodeo SDK:
- [Documentation](https://docs.owlbear.rodeo/)
- [Modal API](https://docs.owlbear.rodeo/extensions/apis/modal/)

## 📝 Notes

- Notion pages can be **private** (they don't need to be public) if shared with the integration
- The modal opens with a responsive size
- You can have multiple pages configured
- The extension is completely private if you don't share it publicly
- **⚠️ Security:** The API token is in `config.js` which is NOT uploaded to GitHub (it's in `.gitignore`)

## 🔐 Security

**For Developers:**

- ✅ Token is stored in Netlify (environment variables)
- ✅ Token is NEVER exposed to the client (uses Netlify Functions as proxy)
- ✅ `config.js` is in `.gitignore` and NOT uploaded to GitHub
- ✅ End users never see or need the token
- ✅ User tokens are stored locally in the browser (localStorage)
- ✅ Server token is optional and only used if user token is not configured

**For Users:**

- ✅ You don't need to know anything about tokens
- ✅ Just use the extension normally
- ✅ Your token is stored locally and never sent to the server (except through secure Netlify Functions)

## 🐛 Troubleshooting

**Page doesn't open:**
- Verify that the Notion URL is correct
- Make sure the URL is complete (without `?source=...` parameters)
- Check that the page is shared with your integration

**Extension doesn't appear:**
- Verify that `manifest.json` is publicly accessible
- Check that the manifest URL is correct in Owlbear

**CORS error:**
- Make sure to host the extension on a server (don't use `file://`)

**Token error:**
- Verify that your token is correct (starts with `secret_` or `ntn_`)
- Make sure the integration has access to the pages you're trying to view

**Cache issues:**
- Use the 🔄 button to reload a specific page
- Use the 🗑️ button to clear all cache

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
- ✅ Visual editor for managing pages and categories
- ✅ Drag and drop reordering
- ✅ Import/Export JSON configuration
- ✅ User token management (global)
- ✅ Per-room configuration
- ✅ External URL support with CSS selectors
- ✅ Block type filtering (`blockTypes`)
- ✅ Nested categories (unlimited depth)
- ✅ Automatic page icons
- ✅ Cache management
- ✅ Debug mode (controlled by Netlify environment variable)

### 🔜 Future Implementations

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

## 📄 License

Personal use - Feel free to modify and use as you wish.
