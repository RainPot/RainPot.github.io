import { getCollection } from "astro:content";
import { getPostSlug } from "../../lib/blog";

export async function GET() {
  const posts = (await getCollection("blog")).filter(post => !post.data.draft);
  const bodies = Object.fromEntries(posts.map(post => [getPostSlug(post), post.body ?? ""]));

  return new Response(JSON.stringify(bodies), {
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
