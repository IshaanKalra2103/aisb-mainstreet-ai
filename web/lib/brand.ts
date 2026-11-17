export const APP_NAME = "MainStreet AI";
export const TAGLINE = "Find AI tools that are worth your time, vetted by people, set up for you.";

/** The iMessage line: owners can text it instead of using the website (same assistant, same shop). */
export const IMESSAGE_NUMBER = "+14152250168";
export const IMESSAGE_DISPLAY = "(415) 225-0168";
/** The draft for "text us" links with no shop yet: the agent's first question is the shop's website, so the cursor waits after "is ". */
export const SITE_DRAFT = "Hi! My shop's website is ";
/** A link that opens Messages to the line, with `body` typed in. "?&body=" works on both iPhone and Android. */
export function smsHref(body?: string): string {
  return body ? `sms:${IMESSAGE_NUMBER}?&body=${encodeURIComponent(body)}` : `sms:${IMESSAGE_NUMBER}`;
}
