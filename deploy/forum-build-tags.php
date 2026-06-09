<?php
/**
 * Idempotent Flarum tag/board structure applier for the rogersense forum.
 *
 * Reads DB credentials straight from the forum's config.php, then upserts the
 * desired board (primary) + content-type (secondary) tags BY SLUG.
 *   - existing tag with same slug  -> updated (name/color/desc/position/parent/hidden)
 *   - missing slug                 -> created
 *   - any other pre-existing tag   -> LEFT UNTOUCHED (never deleted)
 *
 * It prints the tag table before and after so you can reconcile the old
 * welcome-setup tags by hand.
 *
 * Usage on the VPS:
 *   php forum-build-tags.php [/path/to/config.php]   (default: ./config.php or /var/www/rogersense-forum/config.php)
 *   then:  php flarum cache:clear
 */

$candidates = array_filter([
    $argv[1] ?? null,
    getcwd() . '/config.php',
    '/var/www/rogersense-forum/config.php',
]);
$configPath = null;
foreach ($candidates as $c) {
    if ($c && file_exists($c)) { $configPath = $c; break; }
}
if (!$configPath) {
    fwrite(STDERR, "config.php not found (tried: " . implode(', ', $candidates) . ")\n");
    exit(1);
}

$config = require $configPath;
$db = $config['database'] ?? null;
if (!$db) { fwrite(STDERR, "no [database] section in $configPath\n"); exit(1); }
$prefix = $db['prefix'] ?? '';
$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=%s',
    $db['host'], $db['port'] ?? 3306, $db['database'], $db['charset'] ?? 'utf8mb4'
);
$pdo = new PDO($dsn, $db['username'], $db['password'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);
$T = "`{$prefix}tags`";
$S = "`{$prefix}settings`";

// ---- desired structure -------------------------------------------------
// Primary boards: one required primary tag per discussion. position drives order.
$boards = [
    ['slug' => 'lidar',           'name' => 'LiDAR 激光雷达',     'color' => '#14b8a6', 'desc' => '激光雷达模块：选型 · 上手 · 项目 · 点云处理 · 排错', 'hidden' => 0],
    ['slug' => 'proximity',       'name' => 'Proximity 接近感应', 'color' => '#0ea5e9', 'desc' => '接近 / 距离感应：选型 · 上手 · 项目 · 标定 · 排错',     'hidden' => 0],
    ['slug' => 'ble',             'name' => 'Bluetooth / BLE',    'color' => '#3b82f6', 'desc' => '低功耗蓝牙：连接 · 数据传输 · 低功耗 · OTA · 排错',   'hidden' => 0],
    ['slug' => 'compute',         'name' => 'RK / 计算板',        'color' => '#6366f1', 'desc' => 'Rockchip 计算板：系统 · BSP · 边缘 AI · 外设驱动（即将上线）', 'hidden' => 1],
    ['slug' => 'getting-started', 'name' => 'Getting Started',    'color' => '#22c55e', 'desc' => '新手必读：选板 · 环境搭建 · 下单发货 · 论坛指南',    'hidden' => 0],
    ['slug' => 'support',         'name' => 'Support / FAQ',      'color' => '#f59e0b', 'desc' => '售后与常见问题 · 交期物流 · 保修 · 定制开发流程',     'hidden' => 0],
    ['slug' => 'announcements',   'name' => 'Announcements',      'color' => '#ef4444', 'desc' => '新品发布 · 固件更新 · 活动公告',                      'hidden' => 0],
];

// Secondary tags: content type, optional, no position (NULL), no parent.
$secondary = [
    ['slug' => 'tutorial',  'name' => 'Tutorial 教程',  'color' => '#0ea5e9'],
    ['slug' => 'project',   'name' => 'Project 项目',   'color' => '#8b5cf6'],
    ['slug' => 'qa',        'name' => 'Q&A 问答',       'color' => '#10b981'],
    ['slug' => 'downloads', 'name' => 'Downloads 资料', 'color' => '#64748b'],
    ['slug' => 'selection', 'name' => '选型',           'color' => '#f97316'],
];

// ---- helpers -----------------------------------------------------------
function dumpTags(PDO $pdo, string $T): void {
    $rows = $pdo->query("SELECT id, name, slug, position, parent_id, is_hidden, discussion_count FROM $T ORDER BY parent_id IS NOT NULL, position, id")->fetchAll();
    printf("  %-4s %-26s %-18s %-4s %-7s %-6s %s\n", 'id', 'name', 'slug', 'pos', 'parent', 'hidden', 'count');
    foreach ($rows as $r) {
        printf("  %-4s %-26s %-18s %-4s %-7s %-6s %s\n",
            $r['id'], mb_strimwidth($r['name'], 0, 26), $r['slug'],
            $r['position'] ?? '-', $r['parent_id'] ?? '-', $r['is_hidden'], $r['discussion_count']);
    }
}

function upsertTag(PDO $pdo, string $T, array $d, ?int $position): string {
    $st = $pdo->prepare("SELECT id FROM $T WHERE slug = ?");
    $st->execute([$d['slug']]);
    $id = $st->fetchColumn();
    $hidden = $d['hidden'] ?? 0;
    if ($id) {
        $pdo->prepare("UPDATE $T SET name=?, color=?, description=?, position=?, is_hidden=? WHERE id=?")
            ->execute([$d['name'], $d['color'], $d['desc'] ?? null, $position, $hidden, $id]);
        return "updated #$id {$d['slug']}";
    }
    $pdo->prepare("INSERT INTO $T (name, slug, color, description, position, is_hidden, discussion_count) VALUES (?,?,?,?,?,?,0)")
        ->execute([$d['name'], $d['slug'], $d['color'], $d['desc'] ?? null, $position, $hidden]);
    return "created #" . $pdo->lastInsertId() . " {$d['slug']}";
}

function setSetting(PDO $pdo, string $S, string $key, string $value): void {
    // REPLACE on the unique `key`
    $pdo->prepare("REPLACE INTO $S (`key`, `value`) VALUES (?, ?)")->execute([$key, $value]);
}

// ---- run ---------------------------------------------------------------
echo "== config: $configPath  (db {$db['database']}, prefix '{$prefix}')\n\n";
echo "== tags BEFORE:\n";
dumpTags($pdo, $T);

echo "\n== applying boards (primary):\n";
$pos = 0;
foreach ($boards as $b) {
    echo "  - " . upsertTag($pdo, $T, $b, $pos++) . "\n";
}
echo "\n== applying content-type tags (secondary):\n";
foreach ($secondary as $s) {
    echo "  - " . upsertTag($pdo, $T, $s, null) . "\n";
}

echo "\n== settings: require exactly 1 primary tag per discussion\n";
setSetting($pdo, $S, 'flarum-tags.min_primary_tags', '1');
setSetting($pdo, $S, 'flarum-tags.max_primary_tags', '1');
setSetting($pdo, $S, 'flarum-tags.min_secondary_tags', '0');

echo "\n== tags AFTER:\n";
dumpTags($pdo, $T);

echo "\nDone. Now run:  php flarum cache:clear\n";
echo "(any pre-existing tags above that you no longer want, delete from Admin > Tags by hand.)\n";
