# Pre-launch professional review checklist

This document is a working brief for an Italian/EU lawyer or qualified privacy
professional. It is not legal advice and must be reviewed before a definitive
public launch.

## Open-source and distribution

- Confirm that releasing the complete corresponding source under AGPL-3.0
  satisfies the chosen use of PyMuPDF in both the notarized macOS build and any
  network-accessible edition.
- Verify that every distributed DMG/ZIP has a durable, prominent link to the
  exact source tag and build instructions for that binary.
- Review `LICENSE`, `THIRD_PARTY_NOTICES.md`, `TRADEMARKS.md` and all dependency
  attributions.
- Confirm whether any build scripts, signing configuration or other material is
  part of the “Corresponding Source” for the published object code.
- Ensure that no proprietary EULA contradicts the rights granted by AGPL-3.0.

## Privacy and cookies

- Confirm the controller identity, registered/contact address and privacy
  contact to publish for Tomorrow Now.
- Review the statement that PDF processing occurs only in the browser or in the
  local Mac application and that document contents are not uploaded.
- Document hosting/CDN access logs, retention, processors, legal basis,
  international transfers and data-subject rights.
- Confirm whether only technically necessary storage/cookies are used. If
  analytics or marketing tags are added later, reassess consent and cookie
  banner requirements before enabling them.

## Terms and product claims

- Review warranty and liability limitations, acceptable use, availability and
  support wording for a free tool.
- Review security and confidentiality claims so they accurately match the
  deployed architecture.
- Confirm the independent-project disclaimer and avoid comparative claims that
  could imply affiliation with Adobe or Apple.
- Review accessibility, consumer law and jurisdiction clauses relevant to the
  target countries.

## Release evidence to retain

- Source commit and immutable release tag.
- DMG/ZIP checksums, build logs, notarization receipt and dependency lockfiles.
- A copy of the privacy/terms text displayed at the time of each release.
- The professional’s written review and the date on which requested changes
  were implemented.
