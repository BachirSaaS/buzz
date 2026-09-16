/*
 * Variadic wrappers for open/openat — the ONLY C code in sandpit.
 *
 * open() and openat() are variadic in libc (mode_t is only present with
 * O_CREAT). On ARM64, variadic arguments use the stack while fixed args
 * use registers. Rust can't define functions that receive variadic args,
 * so these C wrappers extract mode via va_arg and call the originals.
 *
 * The Rust policy check runs first; if blocked it sets errno and we
 * return -1 without calling the real function.
 */

#include <fcntl.h>
#include <stdarg.h>
#include <errno.h>
#include <sys/types.h>

/* Rust policy checks — return 0 if allowed, -1 if blocked (sets errno) */
extern int sandpit_check_open(const char *path, int flags);
extern int sandpit_check_openat(int fd, const char *path, int flags);

/* Original function pointers — set by Rust at init time */
extern void *sandpit_real_open;
extern void *sandpit_real_openat;

int sandpit_open(const char *path, int flags, ...) {
    if (sandpit_check_open(path, flags) != 0)
        return -1;
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    typedef int (*open_fn)(const char *, int, ...);
    open_fn real = (open_fn)sandpit_real_open;
    if (!real) { errno = ENOSYS; return -1; }
    return real(path, flags, mode);
}

int sandpit_openat(int fd, const char *path, int flags, ...) {
    if (sandpit_check_openat(fd, path, flags) != 0)
        return -1;
    mode_t mode = 0;
    if (flags & O_CREAT) {
        va_list ap;
        va_start(ap, flags);
        mode = (mode_t)va_arg(ap, int);
        va_end(ap);
    }
    typedef int (*openat_fn)(int, const char *, int, ...);
    openat_fn real = (openat_fn)sandpit_real_openat;
    if (!real) { errno = ENOSYS; return -1; }
    return real(fd, path, flags, mode);
}
