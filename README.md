# Content Machine review page

The page behind Content Machine's review links (`https://astrokidstudios.github.io/cm-review/#<code>`).
It shows a post like Instagram (carousel + caption) and lets anyone with the link tap a slide to pin a note.

- Data lives in the Supabase project `content-machine-reviews`. The page only uses the publishable key and two
  functions: `get_review(token)` and `add_comment(...)`. Every table is closed to everything else.
- Content Machine makes, lists and tidies reviews through the `cm-admin` edge function with its own key.
- Plain HTML/CSS/JS, no build step. GitHub Pages serves the `main` branch as is.
