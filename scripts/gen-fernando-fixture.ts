// =============================================================================
// One-off script: Generate Fernando fixture from sampled JSON
// =============================================================================
// Usage: bun scripts/gen-fernando-fixture.ts > scripts/seed/lib/fixtures/fernando.ts

const data = await Bun.file("data/samples/profile-fernando_quezada_ceballos.json").json();

const lines: string[] = [];
const w = (s: string) => lines.push(s);

w(`// =============================================================================`);
w(`// Fernando QUEZADA CEBALLOS — Notes-intensive real profile fixture`);
w(`// =============================================================================`);
w(`// Auto-generated from data/samples/profile-fernando_quezada_ceballos.json`);
w(`// 42-B COR case, 50 court case updates + replies, address changes, fee K`);
w(``);
w(`import type { Database } from "bun:sqlite";`);
w(``);
w(`const ID = {`);
w(`  profile: "fixture-fernando-profile",`);
w(`  apptM: "fixture-fernando-appt-m",`);
w(`  apptLB: "fixture-fernando-appt-lb",`);
w(`  feeK: "fixture-fernando-feek",`);
w(`  courtCase: "fixture-fernando-courtcase",`);
w(`  addrChange: "fixture-fernando-addrchange",`);
w(`};`);
w(``);
w(`export function seedFernando(db: Database, batchId: number): void {`);
w(`  const insertProfile = db.prepare(\``);
w(`    INSERT INTO profiles (`);
w(`      batch_id, local_id, name, email, phone, notes,`);
w(`      next_interaction, priority, address, raw_column_values`);
w(`    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
w(`  \`);`);
w(``);
w(`  const insertContract = db.prepare(\``);
w(`    INSERT INTO contracts (`);
w(`      batch_id, local_id, profile_local_id, name,`);
w(`      case_type, value, contract_id, status, raw_column_values`);
w(`    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
w(`  \`);`);
w(``);
w(`  const insertBoardItem = db.prepare(\``);
w(`    INSERT INTO board_items (`);
w(`      batch_id, local_id, board_key, group_title, name,`);
w(`      status, next_date, attorney, profile_local_id, column_values`);
w(`    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
w(`  \`);`);
w(``);
w(`  const insertUpdate = db.prepare(\``);
w(`    INSERT INTO client_updates (`);
w(`      batch_id, local_id, profile_local_id, board_item_local_id, board_key,`);
w(`      author_name, author_email, text_body, body_html,`);
w(`      source_type, reply_to_update_id, created_at_source`);
w(`    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
w(`  \`);`);
w(``);
w(`  const insertRel = db.prepare(\``);
w(`    INSERT OR IGNORE INTO item_relationships (`);
w(`      batch_id, source_table, source_local_id,`);
w(`      target_table, target_local_id,`);
w(`      relationship_type, column_key`);
w(`    ) VALUES (?, ?, ?, ?, ?, ?, ?)`);
w(`  \`);`);
w(``);

// Profile
w(`  // Profile`);
w(`  insertProfile.run(`);
w(`    batchId,`);
w(`    ID.profile,`);
w(`    ${JSON.stringify(data.name)},`);
w(`    "fernandoquezada1965@gmail.com",`);
w(`    "816-547-2302",`);
w(`    "Active Client. 42-B COR case. DMS #18112. A#076-237-761.",`);
w(`    "2026-03-19",`);
w(`    "High",`);
w(`    "2547 Cherry St. Apartment B, Kansas City, MO 64108",`);
w(`    ${JSON.stringify(JSON.stringify({
  case_type: { label: "42-B COR" },
  status: { label: "Active Client" },
  country_of_birth: "",
  date_of_birth: "10/16/1965",
  a_number: "076237761",
  dms_number: "18112",
  attorney: { label: "Michael Sharma-Crawford" },
}))}`);
w(`  );`);
w(``);

// Board items
const items = data.linkedItems as any[];

// Appointments M
const apptM = items.find((i: any) => i.boardKey === "appointments_m");
if (apptM) {
  const status = apptM.item.column_values?.find((c: any) => c.id === "status")?.text ?? null;
  w(`  // Appointment M`);
  w(`  insertBoardItem.run(`);
  w(`    batchId, ID.apptM, "appointments_m", ${JSON.stringify(apptM.item.group?.title)},`);
  w(`    ${JSON.stringify(apptM.item.name)}, ${JSON.stringify(status)}, null, "M", ID.profile,`);
  w(`    ${JSON.stringify(JSON.stringify({ status: { label: status } }))}`);
  w(`  );`);
  w(`  insertRel.run(batchId, "board_items", ID.apptM, "profiles", ID.profile, "profile", "profiles");`);
  w(``);
}

// Appointments LB
const apptLB = items.find((i: any) => i.boardKey === "appointments_lb");
if (apptLB) {
  const status = apptLB.item.column_values?.find((c: any) => c.id === "status")?.text ?? null;
  w(`  // Appointment LB`);
  w(`  insertBoardItem.run(`);
  w(`    batchId, ID.apptLB, "appointments_lb", ${JSON.stringify(apptLB.item.group?.title)},`);
  w(`    ${JSON.stringify(apptLB.item.name)}, ${JSON.stringify(status)}, null, "LB", ID.profile,`);
  w(`    ${JSON.stringify(JSON.stringify({ status: { label: status } }))}`);
  w(`  );`);
  w(`  insertRel.run(batchId, "board_items", ID.apptLB, "profiles", ID.profile, "profile", "profiles");`);
  w(``);
}

// Fee K
const feeK = items.find((i: any) => i.boardKey === "fee_ks");
if (feeK) {
  const stage = feeK.item.column_values?.find((c: any) => c.id === "deal_stage")?.text ?? "";
  const caseType = feeK.item.column_values?.find((c: any) => c.id === "dropdown_mkv1db6z")?.text ?? "";
  const value = parseInt(feeK.item.column_values?.find((c: any) => c.id === "deal_value")?.text ?? "0");
  w(`  // Fee K`);
  w(`  insertContract.run(`);
  w(`    batchId, ID.feeK, ID.profile,`);
  w(`    ${JSON.stringify(feeK.item.name)},`);
  w(`    ${JSON.stringify(caseType)}, ${value}, "FQ-42B-2023", ${JSON.stringify(stage)},`);
  w(`    ${JSON.stringify(JSON.stringify({
    contract_stage: { label: stage },
    contract_for: { labels: [caseType] },
    af: String(value),
    attorney: { label: "Michael Sharma-Crawford" },
    paralegal: { label: "Luis Morales" },
  }))}`);
  w(`  );`);
  w(`  insertRel.run(batchId, "contracts", ID.feeK, "profiles", ID.profile, "profile", "link_to_profiles");`);
  w(``);

  // Fee K updates
  for (let i = 0; i < feeK.item.updates.length; i++) {
    const u = feeK.item.updates[i];
    emitUpdate(u, null, "fee_ks", `fixture-fernando-feek-update-${i + 1}`);
  }
}

// Court case
const courtCase = items.find((i: any) => i.boardKey === "court_cases");
if (courtCase) {
  const status = courtCase.item.column_values?.find((c: any) => c.id === "project_status")?.text ?? null;
  const nextDate = courtCase.item.column_values?.find((c: any) => c.id === "date__1")?.text ?? null;
  const judge = courtCase.item.column_values?.find((c: any) => c.id === "text6__1")?.text ?? null;
  const tags = courtCase.item.column_values?.find((c: any) => c.id === "tags__1")?.text ?? null;
  w(`  // Court Case`);
  w(`  insertBoardItem.run(`);
  w(`    batchId, ID.courtCase, "court_cases", ${JSON.stringify(courtCase.item.group?.title)},`);
  w(`    ${JSON.stringify(courtCase.item.name)}, ${JSON.stringify(status)}, ${JSON.stringify(nextDate)}, "LB", ID.profile,`);
  w(`    ${JSON.stringify(JSON.stringify({
    status: { label: status },
    x_next_hearing_date: { date: nextDate },
    judge: judge,
    tags: { labels: tags ? [tags] : [] },
    hearing_type: { label: "MCH" },
    attorney: { label: "Lucy Betteridge" },
    paralegal: { label: "Mayra Ruiz" },
  }))}`);
  w(`  );`);
  w(`  insertRel.run(batchId, "board_items", ID.courtCase, "profiles", ID.profile, "profile", "profiles");`);
  w(`  insertRel.run(batchId, "board_items", ID.courtCase, "contracts", ID.feeK, "fee_k", "link_to_fee_ks");`);
  w(``);

  // All 50 court case updates + their replies
  w(`  // Court case updates (${courtCase.item.updates.length} updates)`);
  for (let i = 0; i < courtCase.item.updates.length; i++) {
    const u = courtCase.item.updates[i];
    const updateId = `fixture-fernando-cc-update-${i + 1}`;
    emitUpdate(u, "ID.courtCase", "court_cases", updateId);

    // Replies
    if (u.replies?.length > 0) {
      for (let j = 0; j < u.replies.length; j++) {
        const r = u.replies[j];
        emitReply(r, "ID.courtCase", "court_cases", `fixture-fernando-cc-reply-${i + 1}-${j + 1}`, updateId);
      }
    }
  }
}

// Address changes
const addrChange = items.find((i: any) => i.boardKey === "address_changes");
if (addrChange) {
  const status = addrChange.item.column_values?.find((c: any) => c.id === "project_status" || c.id === "status")?.text ?? null;
  w(`  // Address Change`);
  w(`  insertBoardItem.run(`);
  w(`    batchId, ID.addrChange, "address_changes", ${JSON.stringify(addrChange.item.group?.title)},`);
  w(`    ${JSON.stringify(addrChange.item.name)}, ${JSON.stringify(status)}, null, null, ID.profile,`);
  w(`    ${JSON.stringify(JSON.stringify({ status: { label: status } }))}`);
  w(`  );`);
  w(`  insertRel.run(batchId, "board_items", ID.addrChange, "profiles", ID.profile, "profile", "profiles");`);
  w(``);

  // Address change updates
  w(`  // Address change updates (${addrChange.item.updates.length})`);
  for (let i = 0; i < addrChange.item.updates.length; i++) {
    const u = addrChange.item.updates[i];
    emitUpdate(u, "ID.addrChange", "address_changes", `fixture-fernando-addr-update-${i + 1}`);
  }
}

w(`}`);

function emitUpdate(u: any, boardItemRef: string | null, boardKey: string, localId: string) {
  const author = u.creator?.name ?? "Monday.com Automation";
  const email = u.creator?.email ?? "importantdocuments@sharma-crawford.com";
  const textBody = (u.text_body ?? "").replace(/\r\n/g, "\n");
  const bodyHtml = (u.body ?? "").replace(/\r\n/g, "\n");

  w(`  insertUpdate.run(`);
  w(`    batchId,`);
  w(`    ${JSON.stringify(localId)},`);
  w(`    ID.profile,`);
  w(`    ${boardItemRef ?? "null"},`);
  w(`    ${JSON.stringify(boardKey)},`);
  w(`    ${JSON.stringify(author)},`);
  w(`    ${JSON.stringify(email)},`);
  w(`    ${JSON.stringify(textBody)},`);
  w(`    ${JSON.stringify(bodyHtml)},`);
  w(`    "update",`);
  w(`    null,`);
  w(`    ${JSON.stringify(u.created_at)}`);
  w(`  );`);
  w(``);
}

function emitReply(r: any, boardItemRef: string, boardKey: string, localId: string, parentId: string) {
  const author = r.creator?.name ?? "Monday.com Automation";
  const email = r.creator?.email ?? "importantdocuments@sharma-crawford.com";
  const textBody = (r.text_body ?? "").replace(/\r\n/g, "\n");
  const bodyHtml = (r.body ?? "").replace(/\r\n/g, "\n");

  w(`  insertUpdate.run(`);
  w(`    batchId,`);
  w(`    ${JSON.stringify(localId)},`);
  w(`    ID.profile,`);
  w(`    ${boardItemRef},`);
  w(`    ${JSON.stringify(boardKey)},`);
  w(`    ${JSON.stringify(author)},`);
  w(`    ${JSON.stringify(email)},`);
  w(`    ${JSON.stringify(textBody)},`);
  w(`    ${JSON.stringify(bodyHtml)},`);
  w(`    "reply",`);
  w(`    ${JSON.stringify(parentId)},`);
  w(`    ${JSON.stringify(r.created_at)}`);
  w(`  );`);
  w(``);
}

console.log(lines.join("\n"));
