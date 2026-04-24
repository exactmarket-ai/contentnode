import sgMail from '@sendgrid/mail'

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? ''
const FROM_EMAIL = process.env.FROM_EMAIL ?? 'reviews@exactmarket.com'
const FROM_NAME = process.env.FROM_NAME ?? 'Exact Market'

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY)
}

export interface TeamInviteEmailParams {
  to: { name: string; email: string }
  invitedByName: string
  agencyName: string
  role: string
  loginUrl: string
}

export async function sendTeamInviteEmail(params: TeamInviteEmailParams): Promise<void> {
  const { to, invitedByName, agencyName, role, loginUrl } = params

  if (!SENDGRID_API_KEY) {
    console.log(`[email] No SendGrid key — would send team invite to ${to.email}: ${loginUrl}`)
    return
  }

  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)

  try {
    await sgMail.send({
      to: { name: to.name, email: to.email },
      from: { name: FROM_NAME, email: FROM_EMAIL },
      subject: `You've been invited to ${agencyName} on ContentNode`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #a200ee; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <p style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600; margin: 0; letter-spacing: 0.05em;">CONTENTNODE</p>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e8e7e1;">
            <h2 style="color: #1a1a14; font-size: 20px; margin: 0 0 12px;">You've been invited</h2>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">
              Hi ${to.name},
            </p>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              <strong style="color: #1a1a14;">${invitedByName}</strong> has invited you to join
              <strong style="color: #1a1a14;">${agencyName}</strong> on ContentNode as a
              <strong style="color: #a200ee;">${roleLabel}</strong>.
            </p>
            <a href="${loginUrl}"
               style="display: inline-block; background: #a200ee; color: #ffffff; text-decoration: none;
                      padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              Accept Invitation
            </a>
            <p style="color: #b4b2a9; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
              If you didn't expect this invitation, you can safely ignore this email.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${to.name},\n\n${invitedByName} has invited you to join ${agencyName} on ContentNode as a ${roleLabel}.\n\nAccept your invitation here: ${loginUrl}\n\nIf you didn't expect this, ignore this email.`,
    })
    console.log(`[email] Team invite sent to ${to.email}`)
  } catch (err) {
    const detail = (err as { response?: { body?: unknown } })?.response?.body
    console.error(`[email] SendGrid error for ${to.email}:`, detail ?? err)
    throw err
  }
}

export interface AssignmentEmailParams {
  to: { name: string | null; email: string }
  assignedByName: string | null
  runName: string
  clientName: string
  boardUrl: string
}

export async function sendAssignmentEmail(params: AssignmentEmailParams): Promise<void> {
  const { to, assignedByName, runName, clientName, boardUrl } = params

  if (!SENDGRID_API_KEY) {
    console.log(`[email] No SendGrid key — would notify ${to.email} of assignment: ${boardUrl}`)
    return
  }

  const assignerLabel = assignedByName ?? 'Someone'
  const recipientLabel = to.name ?? to.email

  try {
    await sgMail.send({
      to: { name: to.name ?? to.email, email: to.email },
      from: { name: FROM_NAME, email: FROM_EMAIL },
      subject: `You've been assigned: ${runName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #a200ee; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <p style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600; margin: 0; letter-spacing: 0.05em;">CONTENTNODE</p>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e8e7e1;">
            <h2 style="color: #1a1a14; font-size: 20px; margin: 0 0 12px;">You've been assigned a piece of content</h2>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">Hi ${recipientLabel},</p>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              <strong style="color: #1a1a14;">${assignerLabel}</strong> has assigned you to review
              <strong style="color: #1a1a14;">${runName}</strong>
              for <strong style="color: #1a1a14;">${clientName}</strong>.
            </p>
            <a href="${boardUrl}"
               style="display: inline-block; background: #a200ee; color: #ffffff; text-decoration: none;
                      padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              Open Content Board
            </a>
            <p style="color: #b4b2a9; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
              You're receiving this because you were assigned to a content item on ContentNode.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${recipientLabel},\n\n${assignerLabel} has assigned you to review "${runName}" for ${clientName}.\n\nOpen the board here: ${boardUrl}`,
    })
    console.log(`[email] Assignment notification sent to ${to.email}`)
  } catch (err) {
    const detail = (err as { response?: { body?: unknown } })?.response?.body
    console.error(`[email] SendGrid error for ${to.email}:`, detail ?? err)
    // Don't throw — assignment should succeed even if email fails
  }
}

export interface ReviewEmailParams {
  to: { name: string; email: string }
  clientName: string
  workflowName: string
  portalUrl: string
}

export interface MentionEmailParams {
  to: { name: string | null; email: string }
  mentionedBy: string
  runName: string
  clientName: string
  commentBody: string
  boardUrl: string
}

export async function sendMentionEmail(params: MentionEmailParams): Promise<void> {
  const { to, mentionedBy, runName, clientName, commentBody, boardUrl } = params

  if (!SENDGRID_API_KEY) {
    console.log(`[email] No SendGrid key — would notify ${to.email} of mention by ${mentionedBy}`)
    return
  }

  const recipientLabel = to.name ?? to.email
  const preview = commentBody.length > 200 ? commentBody.slice(0, 200) + '…' : commentBody

  try {
    await sgMail.send({
      to: { name: to.name ?? to.email, email: to.email },
      from: { name: FROM_NAME, email: FROM_EMAIL },
      subject: `${mentionedBy} mentioned you in: ${runName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #a200ee; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <p style="color: rgba(255,255,255,0.9); font-size: 13px; font-weight: 600; margin: 0; letter-spacing: 0.05em;">CONTENTNODE</p>
          </div>
          <div style="background: #ffffff; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #e8e7e1;">
            <h2 style="color: #1a1a14; font-size: 20px; margin: 0 0 12px;">You were mentioned</h2>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">Hi ${recipientLabel},</p>
            <p style="color: #5c5b52; font-size: 14px; line-height: 1.6; margin: 0 0 16px;">
              <strong style="color: #1a1a14;">${mentionedBy}</strong> mentioned you in a comment on
              <strong style="color: #1a1a14;">${runName}</strong> (${clientName}):
            </p>
            <div style="background: #f8f7f4; border-left: 3px solid #a200ee; padding: 12px 16px; border-radius: 0 8px 8px 0; margin: 0 0 24px; color: #1a1a14; font-size: 14px; line-height: 1.6;">
              ${preview}
            </div>
            <a href="${boardUrl}"
               style="display: inline-block; background: #a200ee; color: #ffffff; text-decoration: none;
                      padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              View on Pipeline
            </a>
            <p style="color: #b4b2a9; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
              You're receiving this because you were mentioned in a comment on ContentNode.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${recipientLabel},\n\n${mentionedBy} mentioned you in "${runName}" (${clientName}):\n\n"${preview}"\n\nView it here: ${boardUrl}`,
    })
    console.log(`[email] Mention notification sent to ${to.email}`)
  } catch (err) {
    const detail = (err as { response?: { body?: unknown } })?.response?.body
    console.error(`[email] SendGrid error for ${to.email}:`, detail ?? err)
  }
}

export async function sendReviewEmail(params: ReviewEmailParams): Promise<void> {
  const { to, clientName, workflowName, portalUrl } = params

  if (!SENDGRID_API_KEY) {
    console.log(`[email] No SendGrid key — would send review link to ${to.email}: ${portalUrl}`)
    return
  }

  console.log(`[email] Sending review email to ${to.email}`)

  try {
    await sgMail.send({
      to: { name: to.name, email: to.email },
      from: { name: FROM_NAME, email: FROM_EMAIL },
      subject: `Review ready: ${clientName} — ${workflowName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #0f0f11; padding: 24px 32px; border-radius: 12px 12px 0 0;">
            <p style="color: #9333ea; font-size: 13px; font-weight: 600; margin: 0; letter-spacing: 0.05em;">EXACT MARKET</p>
          </div>
          <div style="background: #18181b; padding: 32px; border-radius: 0 0 12px 12px; border: 1px solid #27272a;">
            <h2 style="color: #fafafa; font-size: 20px; margin: 0 0 12px;">Content ready for your review</h2>
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">
              Hi ${to.name},<br><br>
              New content has been prepared for <strong style="color: #fafafa;">${clientName}</strong> and is ready for your review:
              <strong style="color: #fafafa;">${workflowName}</strong>
            </p>
            <a href="${portalUrl}"
               style="display: inline-block; background: #9333ea; color: #ffffff; text-decoration: none;
                      padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px;">
              Review Content
            </a>
            <p style="color: #52525b; font-size: 12px; margin: 24px 0 0; line-height: 1.5;">
              This link expires in 30 days. If you didn't expect this email, you can safely ignore it.
            </p>
          </div>
        </div>
      `,
      text: `Hi ${to.name},\n\nContent is ready for your review: ${workflowName} for ${clientName}.\n\nReview it here: ${portalUrl}\n\nThis link expires in 30 days.`,
    })
    console.log(`[email] Sent successfully to ${to.email}`)
  } catch (err) {
    const detail = (err as { response?: { body?: unknown } })?.response?.body
    console.error(`[email] SendGrid error for ${to.email}:`, detail ?? err)
    throw err  // re-throw so the caller can surface the error
  }
}
