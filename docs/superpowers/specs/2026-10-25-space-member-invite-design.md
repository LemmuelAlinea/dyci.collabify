# Invite regular members from a work space

Status: proposed, awaiting owner approval.

## Intent

The work space's Members tab currently offers only **Add a co-owner**. It searches people with Project manager enabled, and accepting its invitation grants space Owner access. The space Owner needs a separate way to invite an ordinary person into the space from this tab.

## Proposed behavior

- Show **Invite a member** beside **Add a co-owner** to the Owner of an active work space. Keep both actions unavailable on archived spaces and keep education spaces on their class invitation flow.
- Reuse the existing name search and invitation dialog. Search admitted Collabify accounts, not only Project managers. Keep the existing invitation acceptance, decline and withdrawal flow.
- An accepted regular invitation seats the person as a space **Member**. It does not assign a project role or reveal projects they are not on. They may later be invited to a project through its existing flow.
- A regular invitation cannot demote someone already in the space. The existing co-owner invitation continues to raise an eligible person to Owner. Pending invitations show which access level was offered.
- The server, not just the button, enforces an active space, an Owner inviter, an eligible account, no duplicate pending invitation, and the regular Member versus co-owner distinction. Preserve current class invitations and co-owner rules.

## Approaches

1. **Extend the existing invitation record with the offered access level (recommended).** Keep the current co-owner RPC and dialog behavior; add a regular-member invite path and make acceptance apply the stored level. Existing pending invitations retain their co-owner meaning. This keeps one invitation list and response flow but requires a small SQL migration.
2. **Add someone directly to the space.** Fewer changes, but the person would join without accepting an invitation, contrary to the existing invitation experience.
3. **Invite through a project.** The existing project invite already adds space membership, but also grants project access and does not solve a space-only invitation.

## Verification

- SQL checks: regular invite accepts into Member; co-owner invite still requires Project manager and accepts into Owner; class invites unchanged; non-Owners, archived spaces, duplicates and already seated regular members are refused; an existing Owner is never demoted.
- UI checks: the Owner sees both actions and the pending access label; other roles and archived spaces cannot invite. Accepting a regular invitation shows space membership without unintended project visibility.
- Run Vitest, build and relevant SQL suites. The owner signs in for the browser walk; the agent does not.
