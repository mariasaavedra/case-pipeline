// =============================================================================
// Update Factory — Generates realistic client update/case note data
// =============================================================================

import type { Database } from "bun:sqlite";
import { faker } from "./column-generators";

// Staff pool based on real sampled Monday.com data
const STAFF_POOL = [
  { name: "Mayra Ruiz", email: "mayra@sharma-crawford.com" },
  { name: "Rekha Sharma-Crawford", email: "rekha@sharma-crawford.com" },
  { name: "Michael Sharma-Crawford", email: "michael@sharma-crawford.com" },
  { name: "Cynthia de La Cruz", email: "cynthia@sharma-crawford.com" },
  { name: "Natalia Arellano", email: "natalia@sharma-crawford.com" },
  { name: "Lucy Betteridge", email: "lucy@sharma-crawford.com" },
  { name: "Rafael Contreras", email: "rafael@sharma-crawford.com" },
  { name: "Laura Bernal", email: "laura@sharma-crawford.com" },
  { name: "Luis Morales", email: "luis@sharma-crawford.com" },
];

// Short case note templates (real-world style)
const SHORT_TEMPLATES = [
  "Scheduled by CD",
  "M has spoken to public defender",
  "Gave info to M via slack",
  "Fee payment received. Updated Fee K status.",
  "Client confirmed receipt of employment authorization card.",
  "Client needs interpreter for next hearing — Spanish.",
  "Left voicemail for client regarding appointment reminder.",
  "Client's family member called with updated contact info.",
  "Filed I-589 application with USCIS. Receipt pending.",
  "Submitted change of address with EOIR and USCIS.",
  "Brief filed with BIA. Awaiting decision.",
  "Motion to reopen filed. Hearing date TBD.",
  "Hearing rescheduled to next month per judge's order.",
  "Documents sent to client for review and signature.",
  "Client brought originals to office. Copies made for file.",
];

// Long consult note templates (based on real sampled data)
const CONSULT_NOTE_TEMPLATES = [
  "Client is in custody with VD. She had been paroled into the US and then rearrested. It could have been a habeas. But now has VD. The husband works and is thinking about moving. Was here as a J-1 but not subject to the 2-year foreign residency requirement.\n\nWent over the pending I-130, converting it to a CVP, the time delays, bona fides and went over the whole process. They said they had no more questions.",
  "I don't think he has a viable asylum claim. Even without seeing his documents.\nNo Hire.",
  "She entered the USA in 2023 was NTA'ed but per the automated court webpage, her NTA was only docketed today. Her NTA has an original court date in May 2026, but it looks like it has been moved to Feb with \"visiting judge 6\" whoever that maybe. She filed an asylum app with USCIS, it appears they recently \"closed\" it (i.e. realized EOIR has Jurisdiction) she's worried about her EAD which is valid through 2030. I explained that they have to send her a written notice if they were rescinding it and I don't think they would be because she still has a pending asylum app. Told her if she wants representation at the hearing we need $850.00 at least 2 weeks before hearing. Otherwise it's $1500.00",
  "Charged with trespassing, not an issue but waiting on OPT or CPT could it result in discretionary denial yes. Could it cause issues renewing a visa overseas yes. Probably not re-entering the US because not inadm or remo. Has pub defender - she needs to contact me - mspd. Has already been through school disciplinary process and is ok with school. School does not know he was charged need to let them know to see if they will seek to dismiss. Unknown who actually authorized charges. Lots of hypothetical questions, lots of questions for pub defender.",
  "Client called about I-130 processing times. Explained that USCIS is currently processing cases filed in March 2024. Their case was filed in August 2024 so likely 6-8 more months. Client wants to know about expedite options — explained humanitarian basis or financial loss basis but neither seems strong here. Will check NVC processing once I-130 is approved.",
  "Spoke to client about upcoming master hearing. Reviewed the list of applications we plan to file: I-589 (asylum), I-765 (EAD), and I-131 (advance parole). Client understands they need country conditions evidence. Gave deadline of 3 weeks before individual hearing to have all declarations translated and notarized. Client will work on personal declaration this weekend.",
];

// @mention update templates (tagged team member style)
const MENTION_TEMPLATES = [
  { text: "Did you send this file copy?", action: "question" },
  { text: "Can you check if we need to open the e-file?", action: "question" },
  { text: "Please schedule follow-up appointment for client.", action: "request" },
  { text: "Client called — needs to reschedule hearing prep.", action: "info" },
  { text: "Can you send the retainer agreement?", action: "question" },
  { text: "RFE response is due in 30 days. Can you calendar it?", action: "request" },
];

// Automated/system email templates (creator=null in real data)
const AUTOMATED_TEMPLATES = [
  "Outgoing Email\n\nFrom: importantdocuments@sharma-crawford.com\nTo: {staff}@sharma-crawford.com\nSent At: {date}\n{name}'s status changed to OPEN E-FILE!\n\nHi! {name} has paid for his contract. Check if needs to open e-file",
  "Outgoing Email\n\nFrom: importantdocuments@sharma-crawford.com\nTo: {staff}@sharma-crawford.com\nSent At: {date}\n{name}'s Fee K status changed to PAID!\n\nThe contract for {name} has been fully paid.",
  "Outgoing Email\n\nFrom: importantdocuments@sharma-crawford.com\nTo: {staff}@sharma-crawford.com\nSent At: {date}\nNew RFE received for {name}\n\nA new Request for Evidence has been received. Please review and calendar the deadline.",
];

// Reply templates (based on real sampled replies with @mentions)
const REPLY_TEMPLATES = [
  "Yes, I did. I forgot to CC you. Sent on {date}",
  "Got it, thanks for the update.",
  "Will follow up with client tomorrow.",
  "Updated the file accordingly.",
  "Client confirmed via text message.",
  "Done. I also updated the board status.",
  "Noted. Let me know if anything changes.",
  "I already sent it last week. Check the e-file.",
  "Calendared. Deadline is in 30 days.",
];

export interface GeneratedUpdate {
  localId: string;
  profileLocalId: string;
  boardItemLocalId: string | null;
  boardKey: string | null;
  authorName: string;
  authorEmail: string;
  textBody: string;
  bodyHtml: string;
  sourceType: "update" | "reply";
  replyToUpdateId: string | null;
  createdAtSource: string;
}

export class UpdateFactory {
  private db: Database;
  private insertStmt: ReturnType<Database["prepare"]>;

  constructor(db: Database) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO client_updates (
        batch_id, local_id, profile_local_id, board_item_local_id, board_key,
        author_name, author_email, text_body, body_html,
        source_type, reply_to_update_id, created_at_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  generate(options: {
    profileLocalId: string;
    boardItemLocalId?: string;
    boardKey?: string;
    sourceType?: "update" | "reply";
    replyToUpdateId?: string;
    variant?: "short" | "consult" | "mention" | "automated";
    replyToAuthor?: string;
    itemName?: string;
  }): GeneratedUpdate {
    const isReply = options.sourceType === "reply";
    const variant = options.variant ?? (isReply ? "short" : "short");

    let textBody: string;
    let authorName: string;
    let authorEmail: string | null;
    let bodyHtml: string;

    if (variant === "automated") {
      // System-generated (creator=null in real data)
      const tpl = faker.helpers.arrayElement(AUTOMATED_TEMPLATES);
      const targetStaff = faker.helpers.arrayElement(STAFF_POOL);
      const dateStr = faker.date.recent({ days: 30 }).toLocaleDateString("en-US", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      });
      textBody = tpl
        .replace(/\{staff\}/g, targetStaff.name.split(" ")[0]!.toLowerCase())
        .replace(/\{date\}/g, dateStr)
        .replace(/\{name\}/g, options.itemName ?? "Client");
      authorName = "Monday.com Automation";
      authorEmail = "importantdocuments@sharma-crawford.com";
      bodyHtml = textBody.split("\n").map(line =>
        line.trim() ? `<b>${line.startsWith("From:") || line.startsWith("To:") || line.startsWith("Sent At:") ? line : `<u>${line}</u>`}</b>` : "<br>"
      ).join("<br>\n");
    } else if (variant === "mention") {
      // @mention style
      const from = faker.helpers.arrayElement(STAFF_POOL);
      const to = faker.helpers.arrayElement(STAFF_POOL.filter(s => s.name !== from.name));
      const mention = faker.helpers.arrayElement(MENTION_TEMPLATES);
      textBody = `@${to.name} ${mention.text}`;
      authorName = from.name;
      authorEmail = from.email;
      bodyHtml = `<p><a class="user_mention_editor" href="#">@${to.name}</a> ${mention.text}</p>`;
    } else if (variant === "consult") {
      // Long consult note
      const staff = faker.helpers.arrayElement(STAFF_POOL);
      textBody = faker.helpers.arrayElement(CONSULT_NOTE_TEMPLATES);
      authorName = staff.name;
      authorEmail = staff.email;
      bodyHtml = textBody.split("\n").map(p => p.trim() ? `<p>${p}</p>` : "").join("\n");
    } else if (isReply) {
      // Reply with optional @mention back
      const staff = faker.helpers.arrayElement(STAFF_POOL);
      let replyText = faker.helpers.arrayElement(REPLY_TEMPLATES);
      replyText = replyText.replace(/\{date\}/g,
        faker.date.recent({ days: 30 }).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit" })
      );
      if (options.replyToAuthor) {
        textBody = `@${options.replyToAuthor} ${replyText}`;
        bodyHtml = `<p><a class="user_mention_editor" href="#">@${options.replyToAuthor}</a> ${replyText}</p>`;
      } else {
        textBody = replyText;
        bodyHtml = `<p>${replyText}</p>`;
      }
      authorName = staff.name;
      authorEmail = staff.email;
    } else {
      // Short update
      const staff = faker.helpers.arrayElement(STAFF_POOL);
      textBody = faker.helpers.arrayElement(SHORT_TEMPLATES);
      authorName = staff.name;
      authorEmail = staff.email;
      bodyHtml = `<p>${textBody}</p>`;
    }

    return {
      localId: faker.string.uuid(),
      profileLocalId: options.profileLocalId,
      boardItemLocalId: options.boardItemLocalId ?? null,
      boardKey: options.boardKey ?? null,
      authorName,
      authorEmail: authorEmail ?? "",
      textBody,
      bodyHtml,
      sourceType: isReply ? "reply" : "update",
      replyToUpdateId: options.replyToUpdateId ?? null,
      createdAtSource: faker.date
        .recent({ days: 90 })
        .toISOString(),
    };
  }

  persist(batchId: number, update: GeneratedUpdate): void {
    this.insertStmt.run(
      batchId,
      update.localId,
      update.profileLocalId,
      update.boardItemLocalId,
      update.boardKey,
      update.authorName,
      update.authorEmail,
      update.textBody,
      update.bodyHtml,
      update.sourceType,
      update.replyToUpdateId,
      update.createdAtSource
    );
  }

  /**
   * Generate updates for a profile.
   * Mix of variants based on real Monday.com data patterns:
   * - ~40% short notes, ~20% consult notes, ~15% @mentions, ~10% automated emails
   * - ~60% linked to a board item, ~40% profile-level only
   * - ~25% of updates get a reply (with @mention back)
   * - ~10% intentional duplicates for dedup testing
   */
  generateBatchForProfile(
    batchId: number,
    profileLocalId: string,
    boardItems: Array<{ localId: string; boardKey: string }>
  ): GeneratedUpdate[] {
    const count = faker.number.int({ min: 2, max: 8 });
    const updates: GeneratedUpdate[] = [];

    for (let i = 0; i < count; i++) {
      const linkToItem = boardItems.length > 0 && faker.number.float({ min: 0, max: 1 }) < 0.6;
      const linkedItem = linkToItem
        ? faker.helpers.arrayElement(boardItems)
        : null;

      // Pick variant based on weighted distribution
      const roll = faker.number.float({ min: 0, max: 1 });
      let variant: "short" | "consult" | "mention" | "automated";
      if (roll < 0.40) variant = "short";
      else if (roll < 0.60) variant = "consult";
      else if (roll < 0.75) variant = "mention";
      else if (roll < 0.85) variant = "automated";
      else variant = "short"; // fallback

      const update = this.generate({
        profileLocalId,
        boardItemLocalId: linkedItem?.localId,
        boardKey: linkedItem?.boardKey,
        variant,
        itemName: linkedItem ? `${linkedItem.boardKey} item` : "Client",
      });
      this.persist(batchId, update);
      updates.push(update);

      // ~25% chance of a reply (with @mention back to original author)
      if (faker.number.float({ min: 0, max: 1 }) < 0.25) {
        const reply = this.generate({
          profileLocalId,
          boardItemLocalId: linkedItem?.localId,
          boardKey: linkedItem?.boardKey,
          sourceType: "reply",
          replyToUpdateId: update.localId,
          replyToAuthor: update.authorName !== "Monday.com Automation" ? update.authorName : undefined,
        });
        this.persist(batchId, reply);
        updates.push(reply);
      }

      // ~10% chance of duplicate (same author + text + day)
      if (faker.number.float({ min: 0, max: 1 }) < 0.1) {
        const dupe: GeneratedUpdate = {
          ...update,
          localId: faker.string.uuid(),
        };
        this.persist(batchId, dupe);
        updates.push(dupe);
      }
    }

    return updates;
  }
}
