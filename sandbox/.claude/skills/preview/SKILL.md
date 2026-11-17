---
name: preview
description: Make one short preview video of a tool doing its job inside this owner's business.
---

# Preview

1. `ws get profile` and `catalog get <tool_id>`.
2. Write one prompt that shows the job happening in THIS business, filmed like a short documentary shot. Use the
   template for the job:
   - missed-calls: "<owner role> on a job <setting>, phone buzzes in a pocket; cut to a phone screen showing a missed
     call answered and a job booked"
   - reviews: "<owner> at the counter of <business> reading a phone, a new review gets a friendly reply, they smile"
   - social-posts: "<business interior>, a phone on a stand photographs today's special; the post appears on screen"
   - booking: "<customer> books an appointment on a phone at night; next morning <owner> sees the day's schedule"
   - website-chat: "<owner> busy with customers in <business>; on a tablet on the counter a chat assistant answers a
     customer's question about hours"
   - books / quotes / marketing-msgs / menu-inventory: the owner finishing the task in seconds on a tablet, in their
     real setting.
   Keep it to one scene, real-looking people and places, warm natural light, no on-screen text beyond a few words, no
   brand logos.
3. **Your-site clip** (a `booking` or `website-chat` tool, and the profile has a `website`): a recording of the
   tool working on a copy of the shop's own homepage, in exact words, so the owner sees it handle what they need.
   a. `preview site-info --url <website>`. If it fails, skip to step 4.
   b. Start the `site-demo` subagent with the Agent tool. Give it the site-info JSON, the shop's name, the tool's
      name and job, and the exact words, built from what this owner told us they need and real facts on their
      site. website-chat: two short questions their customers really ask (what the owner mentioned first; else
      the most common ones for their kind of shop, like hours, an order or a menu item), each with a one- or
      two-sentence answer from their site. booking: one of their real services, a day, a time and a customer's
      first name ("Haircut, Sat 10:30, Maria"). Never invent prices, hours or policies.
   c. When it answers `page ready <motion sentence>`: `preview record --tool <tool_id>`.
   d. If record fails: `preview make --tool <tool_id> --prompt "Screen recording of a website; the page is
      perfectly still. <motion sentence> The closed button keeps exactly its color and icon from the first
      frame until the click. The panel grows smoothly out of the button, already looking as in the last frame:
      no dark or blank box in between, no other icons. Only the tool moves; no new text, no people, no camera
      move." --first /work/demo_first.jpg --last /work/demo_last.jpg`.
   e. If it says `page failed`, or both fail, do step 4 instead.
4. Otherwise: `preview make --tool <tool_id> --prompt "<prompt>"`. It returns a cached video if one exists. If the
   status is `capped` or `failed`, tell the owner in one sentence and describe what the tool would do instead.
