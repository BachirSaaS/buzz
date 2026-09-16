// Request an ordinary getaddrinfo operation with a caller-selected fallback
// DNS-over-TLS resolver. The XPC keys follow Apple's dnssd_xpc.c protocol.
#include "egress-common.h"

#include <dispatch/dispatch.h>
#include <uuid/uuid.h>
#include <xpc/xpc.h>

#define DNSSD_REQUEST_ID    1
#define OBSERVATION_SECONDS 5

static bool is_probe_hostname(const char* hostname) {
  const char prefix[] = "sandpit-poc-";
  const char suffix[] = ".example.com";
  size_t length = strlen(hostname);

  if (strncmp(hostname, prefix, sizeof(prefix) - 1) != 0 || length > 240 ||
      length < sizeof(suffix)) {
    return false;
  }
  return strcmp(hostname + length - (sizeof(suffix) - 1), suffix) == 0;
}

static xpc_object_t create_fallback_config(const char* hostname, int port) {
  uuid_t uuid;
  uuid_generate_random(uuid);
  uuid_string_t identifier;
  uuid_unparse_lower(uuid, identifier);

  xpc_object_t fallback = xpc_dictionary_create(NULL, NULL, 0);
  // TLS, as emitted by nw_resolver_config_create_tls.
  xpc_dictionary_set_int64(fallback, "Protocol", 1);
  xpc_dictionary_set_int64(fallback, "Class", 3);
  xpc_dictionary_set_int64(fallback, "Port", port);
  xpc_dictionary_set_string(fallback, "Identifier", identifier);
  xpc_dictionary_set_string(fallback, "ProviderName", hostname);

  xpc_object_t servers = xpc_array_create(NULL, 0);
  xpc_array_set_string(servers, XPC_ARRAY_APPEND, "127.0.0.1");
  xpc_dictionary_set_value(fallback, "NameServers", servers);
  xpc_release(servers);

  return fallback;
}

static xpc_object_t create_request(const char* hostname, int port) {
  xpc_object_t fallback = create_fallback_config(hostname, port);
  xpc_object_t params = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(params, "hostname", hostname);
  xpc_dictionary_set_uint64(params, "flags", 0);
  xpc_dictionary_set_uint64(params, "interface_index", 0);
  xpc_dictionary_set_uint64(params, "protocols", 1);  // IPv4.
  xpc_dictionary_set_bool(params, "need_encryption", true);
  xpc_dictionary_set_value(params, "fallback_config", fallback);
  xpc_release(fallback);

  xpc_object_t message = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(message, "command", "getaddrinfo");
  xpc_dictionary_set_uint64(message, "id", DNSSD_REQUEST_ID);
  xpc_dictionary_set_value(message, "params", params);
  xpc_release(params);

  return message;
}

static void print_reply(xpc_object_t reply) {
  xpc_object_t error = NULL;
  if (xpc_get_type(reply) == XPC_TYPE_DICTIONARY) {
    error = xpc_dictionary_get_value(reply, "error");
  }

  bool valid = error && xpc_get_type(error) == XPC_TYPE_INT64;
  long long status = valid ? xpc_int64_get_value(error) : 0;
  bool accepted = valid && status == 0;
  printf("{\"event\":\"dnssd-reply\",\"protocol_reply\":%s,\"error\":%lld,\"accepted\":%s}\n",
         valid ? "true" : "false", status, accepted ? "true" : "false");
}

static void stop_request(xpc_connection_t connection, dispatch_queue_t queue) {
  xpc_object_t stop = xpc_dictionary_create(NULL, NULL, 0);
  xpc_dictionary_set_string(stop, "command", "stop");
  xpc_dictionary_set_uint64(stop, "id", DNSSD_REQUEST_ID);
  xpc_connection_send_message_with_reply(connection, stop, queue, ^(xpc_object_t reply) {
    (void)reply;
    exit(0);
  });
  xpc_release(stop);

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), queue, ^{
    exit(0);
  });
}

int main(int argc, char** argv) {
  if (argc != 3) {
    return 64;
  }

  int port = prepare_probe(argv[2]);
  if (port < 0) {
    return 65;
  }

  // Keep the runnable PoC restricted to synthetic hostnames and loopback.
  const char* hostname = argv[1];
  if (!is_probe_hostname(hostname)) {
    return 64;
  }

  dispatch_queue_t queue =
    dispatch_queue_create("org.sandpit.synthetic.dnssd", DISPATCH_QUEUE_SERIAL);
  xpc_connection_t connection =
    xpc_connection_create_mach_service("com.apple.dnssd.service", queue, 0);
  xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
    (void)event;
  });
  xpc_connection_activate(connection);

  xpc_object_t message = create_request(hostname, port);
  xpc_connection_send_message_with_reply(connection, message, queue, ^(xpc_object_t reply) {
    print_reply(reply);
  });
  xpc_release(message);

  // Explicitly cancel this request so the daemon stops retrying the synthetic
  // TLS connection when the observation window ends.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, OBSERVATION_SECONDS * NSEC_PER_SEC), queue, ^{
    stop_request(connection, queue);
  });
  dispatch_main();
}
