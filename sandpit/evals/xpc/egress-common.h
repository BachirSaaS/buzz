#pragma once

#include <arpa/inet.h>
#include <mach-o/dyld.h>
#include <sys/socket.h>

#include <errno.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define PROBE_TIMEOUT_SECONDS 20

static bool capture_profile(const char* destination) {
  const char* config = getenv("SANDPIT_CONFIG");
  if (!config) {
    return false;
  }

  // Sandpit writes the generated profile next to the child's configuration.
  char path[4096];
  int length = snprintf(path, sizeof(path), "%s", config);
  if (length < 0 || (size_t)length >= sizeof(path)) {
    return false;
  }

  char* slash = strrchr(path, '/');
  if (!slash) {
    return false;
  }

  char* filename = slash + 1;
  size_t remaining = sizeof(path) - (size_t)(filename - path);
  length = snprintf(filename, remaining, "kernel.sb");
  if (length < 0 || (size_t)length >= remaining) {
    return false;
  }

  bool success = false;
  FILE* input = fopen(path, "r");
  FILE* output = fopen(destination, "w");
  if (!input || !output) {
    goto out;
  }

  int ch;
  while ((ch = fgetc(input)) != EOF) {
    if (fputc(ch, output) == EOF) {
      goto out;
    }
  }
  success = !ferror(input);

out:
  if (input) {
    fclose(input);
  }
  if (output && fclose(output) != 0) {
    success = false;
  }
  return success;
}

static void check_direct_connection(uint16_t port) {
  struct sockaddr_in address = {
    .sin_len = sizeof(address),
    .sin_family = AF_INET,
    .sin_port = htons(port),
    .sin_addr.s_addr = htonl(INADDR_LOOPBACK),
  };

  int fd = socket(AF_INET, SOCK_STREAM, 0);
  int result = -1;
  if (fd >= 0) {
    result = connect(fd, (struct sockaddr*)&address, sizeof(address));
  }
  int error = result < 0 ? errno : 0;

  if (fd >= 0) {
    close(fd);
  }
  printf("{\"event\":\"direct-connect\",\"allowed\":%s,\"errno\":%d}\n",
         result == 0 ? "true" : "false", error);
}

static int prepare_probe(const char* port_text) {
  setbuf(stdout, NULL);
  alarm(PROBE_TIMEOUT_SECONDS);

  char* end = NULL;
  long port = strtol(port_text, &end, 10);
  if (!end || *end || port < 1024 || port > 65535) {
    return -1;
  }

  bool interposed = false;
  for (uint32_t i = 0; i < _dyld_image_count(); i++) {
    const char* name = _dyld_get_image_name(i);
    if (name && strstr(name, "libsandpit")) {
      interposed = true;
    }
  }
  printf("{\"event\":\"process\",\"sandpit_config\":%s,\"dyld_interposed\":%s}\n",
         getenv("SANDPIT_CONFIG") ? "true" : "false", interposed ? "true" : "false");

  const char* capture = getenv("POC_CAPTURE_PROFILE");
  if (capture && !capture_profile(capture)) {
    return -1;
  }

  check_direct_connection((uint16_t)port);
  return (int)port;
}
