import { test, expect } from "@playwright/test";
import { findArt, imageInfo, isPhoto, isPublicAddress, normalizeSite, pickPhotos, type ImageInfo } from "../lib/siteart";

// A live owner's page shows their own website's photos and logo (not a Street View guess at their street).

const SHOP = `<!doctype html><html><head>
<meta property="og:image" content="http://shop.test/cdn/shop/files/cover_1200x1200.jpg?v=1">
<meta property="og:image:secure_url" content="https://shop.test/cdn/shop/files/cover_1200x1200.jpg?v=1">
<link rel="shortcut icon" href="//shop.test/favicon_32x32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">{"@type":"CafeOrCoffeeShop","logo":{"@type":"ImageObject","url":"https://shop.test/ld-logo.png"}}</script>
</head><body>
<img src="//shop.test/cdn/shop/files/Logo_400x.png?v=2" class="header__logo-img" alt="Shop" itemprop="logo">
<img src="{{img}}" alt="{{name}}">
<img data-src="//shop.test/cdn/shop/files/bean_{width}x.png?v=3" alt="Peru">
<img src="/small.jpg" srcset="/a-400.jpg 400w, /a-1600.jpg 1600w" alt="Our bar">
<img src="/icons/cart-icon.svg" alt="cart">
<div style="background-image:url('//shop.test/cdn/shop/files/patio_800x800_crop_center.jpg?v=4')"></div>
<img src="data:image/gif;base64,R0lGOD" alt="">
</body></html>`;

test("the page's logos and photos are found and made absolute", () => {
  const art = findArt(SHOP, "https://shop.test/");
  expect(art.logos[0]).toBe("https://shop.test/cdn/shop/files/Logo_400x.png?v=2");
  expect(art.logos).toContain("https://shop.test/ld-logo.png");
  expect(art.logos).toContain("https://shop.test/apple-touch-icon.png");
  expect(art.og).toEqual(["https://shop.test/cdn/shop/files/cover_1600x.jpg?v=1"]);
  expect(art.photos[0]).toBe("https://shop.test/cdn/shop/files/cover_1600x.jpg?v=1");
  expect(art.photos).toEqual(expect.arrayContaining([
    "https://shop.test/cdn/shop/files/bean_1600x.png?v=3",
    "https://shop.test/a-1600.jpg",
    "https://shop.test/cdn/shop/files/patio_1600x.jpg?v=4",
  ]));
  for (const no of ["{{img}}", "cart-icon", "data:", "Logo_400x", "favicon", "/small.jpg"]) {
    expect(art.photos.join(" "), no).not.toContain(no);
  }
});

// Vigilante Coffee's home page: a blank sharing image, a carousel of sale and new-crop banners with text baked in,
// product shots, then real photos of its cafes further down with camera file names.
const PROMOS = `<!doctype html><html><head>
<meta property="og:image" content="https://shop.test/cdn/shop/files/VideoCover_1600x.jpg?v=1">
</head><body>
<div class="home-carousel__bg" style="background-image: url(//shop.test/cdn/shop/files/Holiday_Sale_Web_Banners_1_1400x.jpg?v=2)"></div>
<div class="home-carousel__bg" style="background-image: url(//shop.test/cdn/shop/files/Web_Banner_1400_x_600_px_4_1400x.jpg?v=3)"></div>
<div class="home-carousel__bg" style="background-image: url(//shop.test/cdn/shop/files/graciela-fresh-crop_1400x.jpg?v=4)"></div>
<img src="//shop.test/cdn/shop/files/BlackFridayDeal_1400x.jpg?v=5" alt="">
<img src="//shop.test/cdn/shop/files/hero-1_1400x.jpg?v=6" alt="Thanksgiving sale: 10% off">
<img src="//shop.test/cdn/shop/files/wholesale-roastery_1400x.jpg?v=7" alt="Our roastery">
<img src="/images/ads/wivells-ad-2026-10-22-ws.jpg" alt="">
<img src="/images/mobile-banner.jpg" alt="">
<div class="u-bg-cover" style="background-image: url(//shop.test/cdn/shop/files/IMG-8881b_720x.jpg?v=8)"></div>
<div class="u-bg-cover" style="background-image: url(//shop.test/cdn/shop/files/JT109806_1_720x.jpg?v=9)"></div>
<img src="//shop.test/cdn/shop/files/1400x600-hero_1400x.jpg?v=10" alt="">
</body></html>`;

test("sale banners are skipped, camera photos come right after the sharing image, carousel slides go last", () => {
  const names = findArt(PROMOS, "https://shop.test/").photos.map((u) => new URL(u).pathname.split("/").pop());
  expect(names).toEqual([
    "VideoCover_1600x.jpg", // the sharing image stays first (pickPhotos drops it when it's blank)
    "IMG-8881b_1600x.jpg", "JT109806_1_1600x.jpg", // camera file names: photos of the place
    "wholesale-roastery_1600x.jpg", "1400x600-hero_1600x.jpg", // the rest of the page, in order
    "graciela-fresh-crop_1600x.jpg", // a carousel slide: usually a graphic with words on it
  ]);
});

test("only public internet addresses are read", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) expect(isPublicAddress(ip), ip).toBe(false);
  for (const ip of ["8.8.8.8", "151.101.1.1", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
});

test("a site is an http(s) address on the usual ports, with no login in it", () => {
  expect(normalizeSite("vigilantecoffee.com")?.href).toBe("https://vigilantecoffee.com/");
  expect(normalizeSite("https://shop.test/menu")?.href).toBe("https://shop.test/menu");
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "http://127.0.0.1:3101/", "https://me:pw@shop.test/", "", null]) {
    expect(normalizeSite(bad), String(bad)).toBeNull();
  }
});

const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];

test("image sizes are read from the file header", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(1200), ...be32(630), 8, 6, 0, 0, 0]);
  expect(imageInfo(png)).toEqual({ type: "png", width: 1200, height: 630 });
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc2, 0, 17, 8, ...be16(600), ...be16(1400), 3]);
  expect(imageInfo(jpeg)).toEqual({ type: "jpeg", width: 1400, height: 600 });
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]);
  expect(imageInfo(gif)).toEqual({ type: "gif", width: 800, height: 600 });
  const vp8x = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 10, 0, 0, 0, 0, 0, 0, 0, 0x7f, 0x05, 0, 0x5f, 0x02, 0]);
  expect(imageInfo(vp8x)).toEqual({ type: "webp", width: 1408, height: 608 });
  expect(imageInfo(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'))?.type).toBe("svg");
  expect(imageInfo(new TextEncoder().encode("<html>not an image</html>"))).toBeNull();
});

const jpeg = (width: number, height: number): ImageInfo => ({ type: "jpeg", width, height });

test("a photo is big and not blank; flat covers, slivers, small images and svgs are not", () => {
  // Vigilante Coffee's og:image is a grey sketch on white: 12 KB for 1200 x 675.
  expect(isPhoto(jpeg(1200, 675), 12_000)).toBe(false);
  expect(isPhoto(jpeg(1400, 600), 189_000)).toBe(true);
  expect(isPhoto(jpeg(400, 300), 40_000)).toBe(false);
  expect(isPhoto(jpeg(600, 1400), 200_000)).toBe(false);
  expect(isPhoto({ type: "svg", width: 0, height: 0 }, 9_000)).toBe(false);
});

test("the photos are the sharing image unless blank, then big JPEGs in page order, at most four", () => {
  const og = "https://x/og.jpg";
  const at = (url: string, info: ImageInfo, bytes: number) => ({ url, info, bytes });
  const page = [
    at("https://x/a.jpg", jpeg(1400, 600), 189_000),
    at("https://x/bag.png", { type: "png", width: 1600, height: 1600 }, 1_900_000), // a product cut-out
    null, // failed to load
    at("https://x/thumb.jpg", jpeg(300, 200), 20_000),
    at("https://x/b.jpg", jpeg(1200, 800), 150_000),
    at("https://x/c.jpg", jpeg(1200, 800), 150_000),
    at("https://x/d.jpg", jpeg(1200, 800), 150_000),
  ];
  const urls = (found: Parameters<typeof pickPhotos>[0]) => pickPhotos(found, [og]).map((f) => f.url);
  expect(urls([at(og, jpeg(1200, 630), 90_000), ...page])).toEqual([og, "https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"]);
  expect(urls([at(og, jpeg(1200, 675), 12_000), ...page])).toEqual(["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg", "https://x/d.jpg"]);
  // The site's own sharing image counts whatever its type; other PNGs on the page don't.
  expect(urls([at(og, { type: "png", width: 1200, height: 630 }, 400_000)])).toEqual([og]);
});

test("the photo route refuses anything but a public website", async ({ request }) => {
  for (const q of ["", "site=file%3A%2F%2F%2Fetc%2Fpasswd", "site=http%3A%2F%2F127.0.0.1%2F", "site=http%3A%2F%2Flocalhost%2F",
    "site=shop.test&kind=svg", "site=shop.test&n=9"]) {
    expect((await request.get(`/api/site-art?${q}`)).status(), q).toBe(400);
  }
});
