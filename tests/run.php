<?php
// Minimaler PHP-Testrunner: lädt tests/php/*Test.php, führt alle Funktionen test_* aus.
declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '1');
set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    throw new ErrorException($msg, 0, $no, $file, $line);
});

function assert_true(bool $cond, string $msg = 'Bedingung nicht erfüllt'): void
{
    if (!$cond) {
        throw new RuntimeException($msg);
    }
}

function assert_same(mixed $expected, mixed $actual, string $msg = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(trim($msg . ' erwartet ' . var_export($expected, true) . ', bekommen ' . var_export($actual, true)));
    }
}

/** Erwartet, dass $fn eine Exception wirft (optional: Klasse). */
function assert_throws(callable $fn, string $class = Throwable::class): Throwable
{
    try {
        $fn();
    } catch (Throwable $e) {
        if ($e instanceof $class) {
            return $e;
        }
        throw new RuntimeException('Falsche Exception: ' . get_class($e) . ': ' . $e->getMessage());
    }
    throw new RuntimeException("Keine Exception ($class) geworfen");
}

$before = get_defined_functions()['user'];
foreach (glob(__DIR__ . '/php/*Test.php') ?: [] as $file) {
    require_once $file;
}
$tests = array_filter(
    array_diff(get_defined_functions()['user'], $before),
    static fn(string $f): bool => str_starts_with($f, 'test_')
);

$failed = 0;
foreach ($tests as $t) {
    try {
        $t();
        echo "✔ $t\n";
    } catch (Throwable $e) {
        $failed++;
        echo "✘ $t: " . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
    }
}
printf("\n%d Tests, %d fehlgeschlagen\n", count($tests), $failed);
exit($failed > 0 ? 1 : 0);
