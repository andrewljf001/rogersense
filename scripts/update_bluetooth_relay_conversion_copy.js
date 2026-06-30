const db = require('./database');

const productUrl = '//products/bluetooth-proximity-relay-module';
const contactUrl = '/contact';
const caseUrl = '//cases/production-equipment-proximity-control';
const productImage = '/img?key=products%2F1780756619271_0_rogersense-bluetooth-relay-main-5pcs.png';
const datasheetUrl = '/img?key=products%2F1780756625403_4_rogersense-bluetooth-proximity-relay-module-spec.pdf';

function productCard({ title, body, button }) {
  return `
<a href="${productUrl}" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 16px 36px rgba(13,148,136,.18)';this.querySelector('[data-rs-button]').style.background='#0f766e';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 12px 30px rgba(15,23,42,.10)';this.querySelector('[data-rs-button]').style.background='#0d9488';" style="display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);gap:18px;align-items:stretch;border:1px solid #d8e6e2;border-radius:12px;overflow:hidden;margin:20px 0;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.10);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s;">
  <span style="display:flex;align-items:center;justify-content:center;background:#eef7f5;min-height:150px;padding:10px;">
    <img src="${productImage}" alt="Bluetooth Proximity Relay Module 5PCS Set" style="display:block;width:100%;height:100%;max-height:160px;object-fit:cover;border-radius:8px;"/>
  </span>
  <span style="display:block;padding:18px 18px 18px 0;">
    <span style="display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#dff7f1;color:#0f766e;font-size:.74rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">Integration module</span>
    <strong style="display:block;font-size:1.12rem;line-height:1.35;color:#111827;margin-bottom:7px;">${title}</strong>
    <span style="display:block;color:#475569;line-height:1.65;margin-bottom:12px;">${body}</span>
    <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;background:#0d9488;color:#fff;font-weight:800;transition:background .16s;">${button} &rarr;</span>
  </span>
</a>`.trim();
}

function supportCard({ href = contactUrl, label = 'Engineering support', title, body, button }) {
  return `
<a href="${href}" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 14px 30px rgba(13,148,136,.14)';this.querySelector('[data-rs-button]').style.background='#0d9488';this.querySelector('[data-rs-button]').style.color='#fff';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 8px 22px rgba(15,23,42,.07)';this.querySelector('[data-rs-button]').style.background='#fff';this.querySelector('[data-rs-button]').style.color='#0f766e';" style="display:block;border:1px solid #d8e6e2;border-radius:12px;padding:18px 20px;margin:18px 0;background:#f8fafc;box-shadow:0 8px 22px rgba(15,23,42,.07);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s;">
  <span style="display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#e0f2fe;color:#0369a1;font-size:.74rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">${label}</span>
  <strong style="display:block;font-size:1.08rem;line-height:1.35;color:#111827;margin-bottom:7px;">${title}</strong>
  <span style="display:block;color:#475569;line-height:1.65;margin-bottom:12px;">${body}</span>
  <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;border:1px solid #0d9488;color:#0f766e;font-weight:800;background:#fff;transition:background .16s,color .16s;">${button} &rarr;</span>
</a>`.trim();
}

function downloadCard() {
  return `
<a href="${datasheetUrl}" target="_blank" rel="noopener" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 14px 30px rgba(13,148,136,.16)';this.querySelector('[data-rs-button]').style.background='#0f766e';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 10px 24px rgba(15,23,42,.08)';this.querySelector('[data-rs-button]').style.background='#0d9488';" style="display:flex;align-items:center;gap:16px;border:1px solid #d8e6e2;border-radius:12px;padding:17px 19px;margin:18px 0;background:#fff;box-shadow:0 10px 24px rgba(15,23,42,.08);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s;">
  <span style="display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:12px;background:#ecfdf5;color:#0d9488;font-weight:900;font-size:.82rem;flex:0 0 auto;">PDF</span>
  <span style="display:block;min-width:0;flex:1;">
    <strong style="display:block;font-size:1.06rem;line-height:1.35;color:#111827;margin-bottom:5px;">Download the Bluetooth Relay product specification</strong>
    <span style="display:block;color:#475569;line-height:1.55;">Get wiring notes, relay output details, setup guidance, and integration limits.</span>
  </span>
  <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;background:#0d9488;color:#fff;font-weight:800;white-space:nowrap;transition:background .16s;">Download PDF &rarr;</span>
</a>`.trim();
}

async function updateBlog() {
  const slug = 'production-equipment-proximity-control-bluetooth-relay';
  const { rows } = await db.query('SELECT id, content FROM posts WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Blog post not found: ${slug}`);

  let content = rows[0].content || '';
  const end = `
<h2>Evaluate the module in your own equipment</h2>
<p>If this control pattern fits your machine, fixture, test bench, or access-control project, you can purchase the Rogersense Bluetooth Proximity Relay Module set and test the dry-contact output directly in your own system.</p>
${productCard({
  title: 'Buy the Bluetooth Proximity Relay Module - 5PCS Set',
  body: 'Order a five-module set for prototype validation, controller input tests, relay-output experiments, or small-batch integration work.',
  button: 'View product and buy set'
})}
${downloadCard()}
${supportCard({
  title: 'Need custom relay behavior or OEM integration?',
  body: 'Talk with Rogersense about relay timing, pulse or latching behavior, Bluetooth threshold tuning, pairing workflow adaptation, PLC/controller mapping, and customer-specific firmware logic.',
  button: 'Discuss secondary development'
})}
`.trim();

  if (content.includes('<h2>Evaluate the module in your own equipment</h2>')) {
    content = content.replace(/<h2>Evaluate the module in your own equipment<\/h2>[\s\S]*$/m, end);
  } else if (content.includes('<h2>Where it fits</h2>')) {
    content = content.replace(
      /<h2>Where it fits<\/h2>[\s\S]*$/m,
      `<h2>Where it fits</h2>\n<p>This control pattern is suitable for production fixtures, test benches, auxiliary tools, access-controlled workstations, lab equipment, and other systems that benefit from simple proximity-based enable control.</p>\n\n${end}`
    );
  } else {
    content = `${content}\n\n${end}`;
  }

  await db.query("UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?", [content, rows[0].id]);
  return slug;
}

async function updateCase() {
  const slug = 'production-equipment-proximity-control';
  const { rows } = await db.query('SELECT id, description FROM cases WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Case not found: ${slug}`);

  let description = rows[0].description || '';
  const cta = `</p><p><strong>Evaluate it on your own equipment</strong><br>Machine builders, OEMs, and production-line integrators can purchase the Bluetooth Proximity Relay Module set and test the phone-presence relay behavior directly with their own PLC input, controller enable line, fixture, low-voltage relay interface, or prototype equipment.</p>${productCard({
    title: 'Buy the Bluetooth Proximity Relay Module set',
    body: 'Use the 5PCS set to validate dry-contact wiring, sensing-distance behavior, phone pairing, relay timing, and production-floor control logic.',
    button: 'View product and buy set'
  })}${supportCard({
    title: 'Discuss custom firmware or production-line integration',
    body: 'Rogersense can support relay timing, pulse or latching behavior, Bluetooth threshold tuning, pairing workflow adaptation, PLC/controller signal mapping, and customer-specific firmware logic.',
    button: 'Talk with engineering'
  })}`;

  if (description.includes('<strong>Evaluate it on your own equipment</strong><br>')) {
    description = description.replace(/<\/?p><strong>Evaluate it on your own equipment<\/strong><br>[\s\S]*$/m, cta);
  } else {
    description = `${description}${cta}`;
  }

  await db.query("UPDATE cases SET description = ?, updated_at = datetime('now') WHERE id = ?", [description, rows[0].id]);
  return slug;
}

async function updateProduct() {
  const slug = 'bluetooth-proximity-relay-module';
  const { rows } = await db.query('SELECT id, description FROM products WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Product not found: ${slug}`);

  let description = rows[0].description || '';
  const section = `
<h3>Secondary development and OEM integration support</h3>
<p>This module is supplied as a practical integration set for engineers, machine builders, and OEM teams. You can buy the five-module set for in-house validation, then work with Rogersense if the standard behavior needs to be adapted for your finished product or production process.</p>
<ul>
  <li><strong>Behavior tuning:</strong> relay timing, pulse or latching mode, lock/unlock thresholds, sensing-distance tuning, and phone-pairing workflow adaptation.</li>
  <li><strong>Interface adaptation:</strong> dry-contact mapping for controller inputs, PLC signals, fixture enable circuits, low-voltage locks, and auxiliary relay stages.</li>
  <li><strong>Custom project support:</strong> Rogersense can support customer-specific firmware logic, production test flow, enclosure/labeling guidance, and OEM integration discussion.</li>
</ul>
${supportCard({
  title: 'Need custom Bluetooth relay behavior?',
  body: 'Tell Rogersense about your equipment, wiring interface, required sensing distance, relay behavior, pairing workflow, and production requirements.',
  button: 'Contact Rogersense engineering'
})}
${supportCard({
  href: caseUrl,
  label: 'Application case',
  title: 'See how this module is used for production equipment control',
  body: 'Review the production-equipment proximity-control case to see the module used as a dry-contact enable stage.',
  button: 'View application case'
})}
`.trim();

  if (description.includes('<h3>Secondary development and OEM integration support</h3>')) {
    description = description.replace(
      /<h3>Secondary development and OEM integration support<\/h3>[\s\S]*?(?=<h3>Key specifications<\/h3>|<h3>Integration and compliance notes<\/h3>)/m,
      `${section}\n\n`
    );
  } else if (description.includes('<h3>Key specifications</h3>')) {
    description = description.replace('<h3>Key specifications</h3>', `${section}\n\n<h3>Key specifications</h3>`);
  } else if (description.includes('<h3>Integration and compliance notes</h3>')) {
    description = description.replace('<h3>Integration and compliance notes</h3>', `${section}\n\n<h3>Integration and compliance notes</h3>`);
  } else {
    description = `${description}\n\n${section}`;
  }

  await db.query("UPDATE products SET description = ?, updated_at = datetime('now') WHERE id = ?", [description, rows[0].id]);
  return slug;
}

(async () => {
  const updated = [];
  updated.push(await updateBlog());
  updated.push(await updateCase());
  updated.push(await updateProduct());
  console.log(JSON.stringify({ ok: true, updated }, null, 2));
})().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
