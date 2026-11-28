// One place that turns a machine code into "what happened" plus "what to do next".
// Every code the relay can send has an entry; test/unit.js reads relay/core.js and fails if one is missing.
// msg: default plain-language sentence. fix: the next step (a command when there is one).
export const ERRORS = {
  auth: { msg: 'The relay did not accept your login.', fix: 'Run: slopstream login' },
  bad_chat: { msg: 'That chat name is not valid.', fix: 'Use letters, numbers, dashes or underscores, up to 32 characters.' },
  not_linked: { msg: 'This chat is not linked to anyone yet.', fix: 'Run: slopstream link   (or: slopstream join <code>)' },
  duplicate: { msg: 'This chat is already connected from another window.', fix: 'Close the other window for this chat, then try again.' },
  too_many_invites: { msg: 'You have too many open invites.', fix: 'Withdraw one with: slopstream deny <code>   (see: slopstream requests)' },
  already_linked: { msg: 'This chat is already linked.', fix: 'Pick another chat name, or unlink first: slopstream unlink <chat>' },
  group_full: { msg: 'This group already has the maximum number of chats.', fix: 'Remove a chat from the group first, or start a new link.' },
  too_many_attempts: { msg: 'Too many wrong codes.', fix: 'Wait a few minutes, then check the code with the person who sent it.' },
  bad_code: { msg: 'That code is unknown, expired or already used.', fix: 'Ask the other person for a fresh link: slopstream link' },
  same_user: { msg: 'You cannot link with yourself.', fix: 'Send the link to someone else (a different GitHub account).' },
  busy: { msg: 'Someone has already used that code and is waiting for approval.', fix: 'Check the pending request: slopstream requests' },
  gone: { msg: 'That group no longer exists.', fix: 'Start a new link: slopstream link' },
  already_in_group: { msg: 'You already have a chat in this group.', fix: 'Use the chat you already linked, or unlink it first.' },
  too_many_links: { msg: 'One of you is at the maximum number of links.', fix: 'Unlink one you no longer use: slopstream unlink <chat>' },
  not_found: { msg: 'The relay could not find that.', fix: 'Check the name with: slopstream devices   or   slopstream requests' },
  internal: { msg: 'The relay hit an unexpected error.', fix: 'Try again in a moment. If it keeps happening, run: slopstream doctor' },
  rate_limited: { msg: 'You are sending too fast.', fix: 'Wait a few seconds, then try again.' },
  peer_offline: { msg: 'The other person is offline right now. Nothing was queued.', fix: 'Try again when they are online (link_status shows who is).' },
  ambiguous_target: { msg: 'This group has more than one other person, so the relay does not know who you mean.', fix: 'Name the recipient with the "to" field.' },
  unknown_recipient: { msg: 'That person is not in this link.', fix: 'Check who is linked: link_status (agent) or slopstream links.' },
  empty_or_non_text: { msg: 'The message was empty or not text.', fix: 'Send a non-empty text message.' },
  too_long: { msg: 'That message is too long.', fix: 'Shorten it, or split it into several messages.' },
  github_disabled: { msg: 'This relay does not use GitHub login.', fix: 'Ask the relay owner for a username and token: slopstream setup <relay-url> <user> <token>' },
  github_unavailable: { msg: 'The relay could not reach GitHub.', fix: 'Try again in a minute.' },
  name_taken: { msg: 'That username is already used on this relay.', fix: 'Log in again and pick another name: slopstream login' },
  bad_json: { msg: 'The relay could not read that request.', fix: 'Update slopstream: npm install -g slopstream@latest' },
  bad_target: { msg: 'That is not a valid username.', fix: 'Use their GitHub username, like: slopstream link @alice' },
  too_many_directed: { msg: 'You have sent too many invites to named people today.', fix: 'Try again tomorrow, or share a plain link: slopstream link' },
  not_for_you: { msg: 'This invite was made for someone else.', fix: 'Ask the sender for an invite made for you, or a plain link.' },
  too_many_confirms: { msg: 'You have too many requests waiting for approval in your browser.', fix: 'Finish or wait out the open ones (they expire in 10 minutes), then try again.' },
  upgrade_required: { msg: 'This relay needs a newer slopstream.', fix: 'Run: npm install -g slopstream@latest   (Claude plugin: /plugin update slopstream)' },
  // Bridge-side reasons (no relay code)
  secret_detected: { msg: 'The message looks like it contains a secret, so it was not sent.', fix: 'Remove the secret from the message, or confirm in the pop-up if you really mean to send it.' },
  timeout: { msg: 'The relay did not answer in time.', fix: 'Check your connection, then try again. Run: slopstream doctor' },
  relay_disconnected: { msg: 'The connection to the relay dropped.', fix: 'It reconnects on its own; try again in a few seconds.' },
  unreachable: { msg: 'Could not reach the relay.', fix: 'Check your internet connection, or the relay address: slopstream doctor' },
};

export class RelayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// "What happened.\n  → What to do." The relay's own message wins when it has one, because it carries
// specifics (the group limit, the max text length). An unknown code still gets a generic next step.
export function explain(code, relayMessage) {
  const e = ERRORS[code];
  const given = relayMessage && relayMessage !== code ? String(relayMessage) : '';
  const what = given || e?.msg || `Something went wrong (${code || 'unknown'}).`;
  const fix = e?.fix || 'Run: slopstream doctor';
  const sentence = /[.!?]$/.test(what) ? what : `${what}.`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}\n  → ${fix}`;
}

// A delivery nack reason is a code, sometimes with detail: "too_long (max 8000 chars)".
export const reasonCode = (reason) => String(reason || '').match(/^[a-z_]+/)?.[0] || '';
