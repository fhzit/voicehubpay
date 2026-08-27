<?php

declare(strict_types=1);

/**
 * VoiceHubPay minimal test harness (no external dependencies).
 *
 *   php tests/run.php [--filter=Pattern] [tests/unit|tests/integration|...]
 *
 * Exit code 0 = all pass; 1 = failures; 2 = harness error.
 */

require __DIR__ . '/../src/bootstrap.php';
require __DIR__ . '/support/TestCase.php';

use VoiceHubPay\Tests\TestCase;

$base = dirname(__DIR__);

$filter = null;
$paths = [];
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '--filter=')) {
        $filter = substr($arg, strlen('--filter='));
    } else {
        $paths[] = $arg;
    }
}
if ($paths === []) {
    $paths = [__DIR__ . '/unit', __DIR__ . '/integration'];
}

$files = [];
foreach ($paths as $path) {
    if (is_dir($path)) {
        foreach (glob(rtrim($path, '/') . '/*Test.php') ?: [] as $f) {
            $files[] = $f;
        }
    } elseif (is_file($path)) {
        $files[] = $path;
    }
}
sort($files);
$files = array_values(array_unique($files));

$testCase = new TestCase();
$testCase->basePath = $base;

$ran = 0;
$failed = 0;
$failures = [];

foreach ($files as $file) {
    $suite = basename($file);
    if ($filter !== null && stripos($suite, $filter) === false) {
        continue;
    }
    try {
        $fn = require $file;
        if (!is_callable($fn)) {
            throw new RuntimeException('Test file must return a callable: ' . $file);
        }
        $result = $fn($testCase);
        if (is_array($result)) {
            $ran += (int) ($result['assertions'] ?? 0);
            if (($result['failed'] ?? 0) > 0) {
                $failed += (int) $result['failed'];
                $failures[] = $suite . ': ' . ($result['error'] ?? 'failure');
            }
        }
        fwrite(STDOUT, '  ✓ ' . $suite . PHP_EOL);
    } catch (\Throwable $e) {
        $failed++;
        $failures[] = $suite . ': ' . $e->getMessage();
        fwrite(STDOUT, '  ✗ ' . $suite . ': ' . $e->getMessage() . PHP_EOL);
    }
}

fwrite(STDOUT, PHP_EOL . sprintf('Tests: %d suites, %d assertions, %d failures', count($files), $ran, $failed) . PHP_EOL);
foreach ($failures as $f) {
    fwrite(STDOUT, 'FAILED: ' . $f . PHP_EOL);
}
exit($failed > 0 ? 1 : 0);
