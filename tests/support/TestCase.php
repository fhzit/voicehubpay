<?php

declare(strict_types=1);

namespace VoiceHubPay\Tests;

use VoiceHubPay\App;
use VoiceHubPay\Database\Migrator;
use VoiceHubPay\Security\CryptoService;

/**
 * Shared helpers + assertion utilities for the test harness.
 */
final class TestCase
{
    public string $basePath = '';

    private int $assertions = 0;
    private int $failed = 0;
    private string $error = '';

    /** @var string[] */
    private array $tmpDirs = [];

    // ---- assertions -------------------------------------------------

    public function assertSame(mixed $expected, mixed $actual, string $msg = ''): void
    {
        $this->assertions++;
        if ($expected !== $actual) {
            $this->fail('assertSame(' . var_export($expected, true) . ') got ' . var_export($actual, true) . ($msg !== '' ? ' — ' . $msg : ''));
        }
    }

    public function assertTrue(mixed $cond, string $msg = ''): void
    {
        $this->assertions++;
        if ($cond !== true) {
            $this->fail('assertTrue failed' . ($msg !== '' ? ' — ' . $msg : ''));
        }
    }

    public function assertFalse(mixed $cond, string $msg = ''): void
    {
        $this->assertTrue($cond === false, $msg);
    }

    public function assertNull(mixed $val, string $msg = ''): void
    {
        $this->assertSame(null, $val, $msg);
    }

    public function assertContains(string $needle, string $haystack, string $msg = ''): void
    {
        $this->assertions++;
        if (!str_contains($haystack, $needle)) {
            $this->fail("assertContains '$needle' not found" . ($msg !== '' ? ' — ' . $msg : ''));
        }
    }

    public function assertMatches(string $pattern, string $value, string $msg = ''): void
    {
        $this->assertions++;
        if (!preg_match($pattern, $value)) {
            $this->fail("assertMatches $pattern failed on " . var_export($value, true) . ($msg !== '' ? ' — ' . $msg : ''));
        }
    }

    /**
     * @param class-string<\Throwable> $class
     */
    public function assertThrows(string $class, callable $fn, string $msg = ''): void
    {
        $this->assertions++;
        try {
            $fn();
        } catch (\Throwable $e) {
            if ($e instanceof $class) {
                return;
            }
            $this->fail("expected $class, got " . $e::class . ': ' . $e->getMessage() . ($msg !== '' ? ' — ' . $msg : ''));
            return;
        }
        $this->fail("expected $class but nothing was thrown" . ($msg !== '' ? ' — ' . $msg : ''));
    }

    private function fail(string $msg): void
    {
        $this->failed++;
        $this->error .= ($this->error === '' ? '' : "\n") . $msg;
        throw new \RuntimeException($msg);
    }

    public function assertions(): int
    {
        return $this->assertions;
    }

    public function failed(): int
    {
        return $this->failed;
    }

    public function error(): string
    {
        return $this->error;
    }

    // ---- isolated app -------------------------------------------------

    public function tmpDir(string $tag): string
    {
        $dir = sys_get_temp_dir() . '/vhpay-tests/' . $tag . '-' . bin2hex(random_bytes(4));
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $this->tmpDirs[] = $dir;
        return $dir;
    }

    /**
     * Fresh, fully migrated App pointed at an isolated SQLite database.
     *
     * @return array{0:App,1:\PDO}
     */
    public function freshApp(string $tag = 'db'): array
    {
        $dir = $this->tmpDir($tag);
        $db = $dir . '/test.sqlite';

        $app = new App($this->basePath);
        $app->config->settings()->setMany([
            'DATA_DB_CONNECTION' => 'sqlite',
            'DATA_DB_DATABASE' => $db,
            'APP_TIMEZONE' => 'Asia/Shanghai',
        ]);
        $app->config->reloadSettings();

        // Point crypto at the isolated tmp dir so tests never touch the real
        // storage/.masterkey (card codes round-trip consistently).
        $app->crypto = new CryptoService($dir);

        $pdo = $app->db->pdo();
        (new Migrator($pdo, $this->basePath))->migrate(true);
        return [$app, $pdo];
    }

    /**
     * A CryptoService bound to an isolated base dir (so tests never touch
     * the real storage/).
     */
    public function freshCrypto(string $tag = 'crypto'): CryptoService
    {
        $dir = $this->tmpDir($tag);
        return new CryptoService($dir);
    }

    public function cleanup(): void
    {
        foreach ($this->tmpDirs as $dir) {
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
                \RecursiveIteratorIterator::CHILD_FIRST
            );
            foreach ($it as $f) {
                $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
            }
            @rmdir($dir);
        }
        $this->tmpDirs = [];
    }
}
