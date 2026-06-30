const db = require('./database');

const productUrl = '//products/lidar-s1';
const contactUrl = '/contact';
const productImage = '/img?key=products%2Flidar-s1-2.jpg';
const datasheetUrl = '/img?key=products%2Flidar-s1-spec.pdf';

function productCard({ title, body, button }) {
  return `
<a href="${productUrl}" onmouseenter="this.style.borderColor='#0d9488';this.style.boxShadow='0 16px 36px rgba(13,148,136,.18)';this.querySelector('[data-rs-button]').style.background='#0f766e';" onmouseleave="this.style.borderColor='#d8e6e2';this.style.boxShadow='0 12px 30px rgba(15,23,42,.10)';this.querySelector('[data-rs-button]').style.background='#0d9488';" style="display:grid;grid-template-columns:minmax(110px,170px) minmax(0,1fr);gap:18px;align-items:stretch;border:1px solid #d8e6e2;border-radius:12px;overflow:hidden;margin:20px 0;background:#fff;box-shadow:0 12px 30px rgba(15,23,42,.10);text-decoration:none;color:#111827;transition:border-color .16s,box-shadow .16s,transform .16s;">
  <span style="display:flex;align-items:center;justify-content:center;background:#eef7f5;min-height:150px;padding:10px;">
    <img src="${productImage}" alt="LiDAR S1 development kit" style="display:block;width:100%;height:100%;max-height:160px;object-fit:cover;border-radius:8px;"/>
  </span>
  <span style="display:block;padding:18px 18px 18px 0;">
    <span style="display:inline-flex;align-items:center;padding:4px 9px;border-radius:999px;background:#dff7f1;color:#0f766e;font-size:.74rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;margin-bottom:8px;">Development kit</span>
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
    <strong style="display:block;font-size:1.06rem;line-height:1.35;color:#111827;margin-bottom:5px;">Download the LiDAR S1 product specification</strong>
    <span style="display:block;color:#475569;line-height:1.55;">Get the technical datasheet, interface notes, SDK overview, and integration guidance.</span>
  </span>
  <span data-rs-button style="display:inline-flex;align-items:center;justify-content:center;padding:10px 15px;border-radius:8px;background:#0d9488;color:#fff;font-weight:800;white-space:nowrap;transition:background .16s;">Download PDF &rarr;</span>
</a>`.trim();
}

async function updateBlog() {
  const slug = 'semi-solid-state-lidar-explained';
  const { rows } = await db.query('SELECT id, content FROM posts WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Blog post not found: ${slug}`);

  let content = rows[0].content || '';
  const datasheet = `<h2>Datasheet</h2>\n${downloadCard()}`;
  const cta = `
<h2>Evaluate S1 in your own system</h2>
<p>If you want to move from reading specifications to real integration, Rogersense provides a LiDAR S1 development kit for teams that want to bring point-cloud data into their own ADAS, AMR, robotics, mapping, or industrial perception stack.</p>
${productCard({
  title: 'Buy the LiDAR S1 evaluation kit',
  body: 'Order the S1 kit for in-house integration, SDK bring-up, ROS/ROS2 development, point-cloud testing, and sensor-fusion validation.',
  button: 'View product and buy kit'
})}
${supportCard({
  title: 'Need SDK adaptation or a complete system?',
  body: 'Talk with Rogersense about secondary development, gateway adaptation, timing configuration, navigation reference design, or a full machine-development project.',
  button: 'Discuss your project'
})}
`.trim();

  const talk = `
<h2>Need help planning your integration?</h2>
${supportCard({
  title: 'Talk with Rogersense engineering',
  body: 'Share your FOV, mounting, time-sync, sensor-fusion, SDK, or platform requirements with our engineering team.',
  button: 'Contact engineering'
})}
${supportCard({
  href: 'https://forum.rogersense.com',
  label: 'Technical community',
  title: 'Ask technical questions in the Rogersense forum',
  body: 'Use the forum for integration questions, development discussion, sensor evaluation notes, and community support.',
  button: 'Visit forum'
})}
`.trim();

  if (content.includes('<h2>Datasheet</h2>')) {
    content = content.replace(
      /<h2>Datasheet<\/h2>[\s\S]*?(?=\n\n<h2>Evaluate S1 in your own system<\/h2>|\n\n<h2>Talk to us<\/h2>|\n\n<h2>Need help planning your integration\?<\/h2>)/m,
      datasheet
    );
  }

  if (content.includes('Evaluate S1 in your own system')) {
    content = content.replace(
      /<h2>Evaluate S1 in your own system<\/h2>[\s\S]*$/m,
      `${cta}\n\n${talk}`
    );
  } else if (content.includes('<h2>Talk to us</h2>')) {
    content = content.replace(/<h2>Talk to us<\/h2>[\s\S]*$/m, `${cta}\n\n${talk}`);
  } else {
    content = `${content}\n\n${cta}\n\n${talk}`;
  }

  await db.query("UPDATE posts SET content = ?, updated_at = datetime('now') WHERE id = ?", [content, rows[0].id]);
  return slug;
}

async function updateCase() {
  const slug = 'autonomous-warehouse-robot-lidar';
  const { rows } = await db.query('SELECT id, description FROM cases WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Case not found: ${slug}`);

  let description = rows[0].description || '';
  const cta = `</p><p><strong>Evaluate it on your own robot</strong><br>Teams building a similar AMR, AGV, vehicle, or industrial perception system can purchase the LiDAR S1 development kit and use Rogersense SDK resources and technical support to integrate the sensor into their own platform. We can support C++/Python driver bring-up, ROS&nbsp;2 integration, PTP time-sync configuration, point-cloud debugging, gateway adaptation, and secondary development for customer-specific workflows.</p>${productCard({
    title: 'Buy the LiDAR S1 kit for your AMR or vehicle',
    body: 'Use the S1 kit to evaluate point-cloud performance, bring up the SDK, test ROS 2 workflows, and integrate the sensor into your own platform.',
    button: 'View product and buy kit'
  })}${supportCard({
    title: 'Discuss a complete robot or subsystem project',
    body: 'Rogersense can support sensor selection, gateway hardware, firmware, SDK adaptation, navigation reference design, and full system integration.',
    button: 'Talk with engineering'
  })}<p>If you want more than a sensor evaluation kit, Rogersense can also take on complete subsystem or machine-development work for robot, vehicle, or industrial automation projects.`;

  if (description.includes('Evaluate it on your own robot')) {
    description = description.replace(
      /<\/p><p><strong>Evaluate it on your own robot<\/strong><br>[\s\S]*$/m,
      cta
    );
  } else {
    description += cta;
  }

  await db.query("UPDATE cases SET description = ?, updated_at = datetime('now') WHERE id = ?", [description, rows[0].id]);
  return slug;
}

async function updateProduct() {
  const slug = 'lidar-s1';
  const { rows } = await db.query('SELECT id, description FROM products WHERE slug = ?', [slug]);
  if (!rows[0]) throw new Error(`Product not found: ${slug}`);

  let description = rows[0].description || '';
  const section = `
<h3>Development kit, SDK and integration support</h3>
<p>This product page is for teams that want a practical LiDAR S1 evaluation and development kit, not just a loose sensor. The kit helps you bring S1 into your own vehicle, AMR, robot, mapping platform, or industrial perception system with the hardware and software pieces needed for first integration.</p>
<ul>
  <li><strong>SDK resources:</strong> C++ and Python Driver SDK, ROS/ROS2 SDK, PCAP record/replay workflow, point-cloud visualization, and IMU motion-compensation support.</li>
  <li><strong>Secondary development support:</strong> Rogersense can help with driver adaptation, network setup, PTP/gPTP timing, point-cloud parsing, calibration workflow, gateway integration, and customer-specific configuration.</li>
  <li><strong>Project support:</strong> You can purchase the development kit and integrate it in-house, or ask Rogersense to support a larger subsystem, navigation reference design, or complete machine-development project.</li>
</ul>
${supportCard({
  title: 'Need SDK support or secondary development?',
  body: 'Tell Rogersense about your target platform, mounting position, perception range, time-sync requirements, and software stack.',
  button: 'Contact Rogersense engineering'
})}
`.trim();

  if (description.includes('Development kit, SDK and integration support')) {
    description = description.replace(
      /<h3>Development kit, SDK and integration support<\/h3>[\s\S]*?(?=<h3>Key specifications<\/h3>)/m,
      `${section}\n\n`
    );
  } else if (description.includes('<h3>Key specifications</h3>')) {
    description = description.replace('<h3>Key specifications</h3>', `${section}\n\n<h3>Key specifications</h3>`);
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
