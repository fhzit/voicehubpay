<?php

declare(strict_types=1);

namespace VoiceHubPay\Support;

/**
 * Minimal dependency-free SMTP client for sending transactional/notification
 * email from a PHP process. Supports:
 *   - plaintext, STARTTLS ("tls") and implicit TLS ("ssl") connections
 *   - AUTH LOGIN and AUTH PLAIN
 *   - UTF-8 subject/body with proper MIME/base64 encoding
 *   - text and HTML alternatives
 *
 * It speaks enough SMTP to work against mainstream providers (QQ/163/Gmail/
 * SMTP2GO/etc.) without pulling in a mailer dependency.
 */
final class SmtpMailer
{
    private const CRLF = "\r\n";

    private string $host;
    private int $port;
    private string $encryption; // '' | 'tls' | 'ssl'
    private string $username;
    private string $password;
    private int $timeout;
    private string $fromAddress;
    private string $fromName;

    /** @var resource|null */
    private $socket = null;
    private int $lastCode = 0;

    public function __construct(array $cfg)
    {
        $this->host       = (string) ($cfg['host'] ?? '');
        $this->port       = (int) ($cfg['port'] ?? 587);
        $this->encryption = (string) ($cfg['encryption'] ?? 'tls'); // ''|'tls'|'ssl'
        $this->username   = (string) ($cfg['username'] ?? '');
        $this->password   = (string) ($cfg['password'] ?? '');
        $this->timeout    = (int) ($cfg['timeout'] ?? 15);
        $this->fromAddress= (string) ($cfg['from'] ?? '');
        $this->fromName   = (string) ($cfg['from_name'] ?? '');
    }

    public function lastCode(): int
    {
        return $this->lastCode;
    }

    /**
     * Send one email. Returns true on success. Throws \RuntimeException on error.
     *
     * @param string      $to       recipient address
     * @param string      $subject  UTF-8 subject
     * @param string      $html     optional HTML body
     * @param string      $text     plain-text body (used as fallback if $html empty)
     * @param array       $extra    optional headers (e.g. ['Reply-To' => 'x@y.z'])
     */
    public function send(string $to, string $subject, string $html = '', string $text = '', array $extra = []): bool
    {
        if ($this->host === '' || $this->fromAddress === '') {
            throw new \RuntimeException('SMTP 未配置 host / from 地址。');
        }
        if ($this->smtpConnect() === false) {
            throw new \RuntimeException('无法连接 SMTP 服务器 ' . $this->host . ':' . $this->port);
        }
        try {
            $this->smtpCommand('EHLO ' . gethostname(), [250]);
            if (strtolower($this->encryption) === 'tls') {
                // STARTTLS; re-EHLO after upgrade
                $this->smtpCommand('STARTTLS', [220]);
                $crypto = stream_socket_enable_crypto($this->socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
                if ($crypto !== true) {
                    throw new \RuntimeException('STARTTLS 加密协商失败。');
                }
                $this->smtpCommand('EHLO ' . gethostname(), [250]);
            }
            // Authenticate if a username is supplied.
            if ($this->username !== '') {
                $this->smtpCommand('AUTH LOGIN', [334]);
                $this->smtpRaw(base64_encode($this->username), [334]);
                $this->smtpRaw(base64_encode($this->password), [235]);
            }
            $this->smtpCommand('MAIL FROM:<' . $this->fromAddress . '>', [250]);
            $this->smtpCommand('RCPT TO:<' . $to . '>', [250, 251]);
            $this->smtpCommand('DATA', [354]);

            $message = $this->buildMime($to, $subject, $html, $text, $extra);
            $this->smtpRaw($message . self::CRLF . '.', null); // end-of-data marker; expect 250 next
            $this->smtpRead(250);

            $this->smtpCommand('QUIT', [221]);
            return true;
        } finally {
            $this->smtpClose();
        }
    }

    /** Build a full RFC-5322 message with MIME, suitable as DATA payload. */
    private function buildMime(string $to, string $subject, string $html, string $text, array $extra): string
    {
        $boundary = '----=_Part_' . bin2hex(random_bytes(8));

        $headers = [
            'From' => $this->formatAddress($this->fromName, $this->fromAddress),
            'To' => $to,
            'Subject' => $this->encodeText($subject),
            'MIME-Version' => '1.0',
            'Content-Type' => 'multipart/alternative; boundary="' . $boundary . '"',
            'Date' => gmdate('D, d M Y H:i:s O'),
        ];
        foreach ($extra as $k => $v) {
            $headers[$k] = $v;
        }

        $plain = $text !== '' ? $text : strip_tags(str_replace('<br>', "\n", str_replace(['<br/>','<br />'], "\n", $html)));

        $parts = "\n\n--" . $boundary . self::CRLF
            . "Content-Type: text/plain; charset=UTF-8" . self::CRLF
            . "Content-Transfer-Encoding: base64" . self::CRLF . self::CRLF
            . chunk_split(base64_encode($plain)) . self::CRLF
            . "--" . $boundary . self::CRLF
            . "Content-Type: text/html; charset=UTF-8" . self::CRLF
            . "Content-Transfer-Encoding: base64" . self::CRLF . self::CRLF
            . chunk_split(base64_encode($html !== '' ? $html : '<p>' . $plain . '</p>'))
            . self::CRLF . "--" . $boundary . "--" . self::CRLF;

        $out = '';
        foreach ($headers as $k => $v) {
            $out .= $k . ': ' . $v . self::CRLF;
        }
        return $out . $parts;
    }

    private function formatAddress(string $name, string $addr): string
    {
        return $name !== '' ? $this->encodeText($name) . ' <' . $addr . '>' : $addr;
    }

    /** RFC-2047 encode non-ASCII header text. */
    private function encodeText(string $s): string
    {
        if (preg_match('/[^\x20-\x7E]/', $s)) {
            return '=?UTF-8?B?' . base64_encode($s) . '?=';
        }
        return $s;
    }

    private function smtpConnect(): bool
    {
        $isSsl = strtolower($this->encryption) === 'ssl';
        $scheme = $isSsl ? 'ssl://' : '';
        $errno = 0;
        $errstr = '';
        $this->socket = @stream_socket_client(
            $scheme . $this->host . ':' . $this->port,
            $errno,
            $errstr,
            $this->timeout,
            STREAM_CLIENT_CONNECT,
            $isSsl ? stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]) : null
        );
        if ($this->socket === false) {
            return false;
        }
        stream_set_timeout($this->socket, $this->timeout);
        try {
            $this->smtpRead(220); // greeting
        } catch (\Throwable $e) {
            $this->smtpClose();
            throw new \RuntimeException('SMTP 握手失败: ' . $e->getMessage());
        }
        return true;
    }

    private function smtpCommand(string $cmd, array $expect): void
    {
        $this->smtpRaw($cmd, $expect);
    }

    private function smtpRaw(string $line, ?array $expect): void
    {
        if ($this->socket === null) {
            throw new \RuntimeException('SMTP 连接未建立。');
        }
        fwrite($this->socket, $line . self::CRLF);
        if ($expect !== null) {
            $this->smtpRead($expect);
        }
    }

    private function smtpRead(array $expect): string
    {
        $response = '';
        while (true) {
            $line = fgets($this->socket);
            if ($line === false) {
                throw new \RuntimeException('SMTP 连接被关闭。');
            }
            $response .= $line;
            $code = (int) substr($line, 0, 3);
            // multi-line response ends when char 4 is a space
            if (strlen($line) >= 4 && $line[3] === ' ') {
                break;
            }
        }
        $this->lastCode = $code;
        if (!in_array($code, $expect, true)) {
            throw new \RuntimeException('SMTP 服务器返回 ' . $code . ': ' . trim($response));
        }
        return $response;
    }

    private function smtpClose(): void
    {
        if (is_resource($this->socket)) {
            @fclose($this->socket);
        }
        $this->socket = null;
    }
}