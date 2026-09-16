// Evaluate a synthetic leaf with its issuer omitted. Its AIA extension points
// at the harness's loopback HTTP server. Anchors apply to this evaluation only.
#include "egress-common.h"

#include <Security/Security.h>

static SecCertificateRef read_certificate(const char* path) {
  FILE* file = fopen(path, "rb");
  if (!file) {
    return NULL;
  }

  uint8_t bytes[8192];
  size_t count = fread(bytes, 1, sizeof(bytes), file);
  bool failed = ferror(file) || count == sizeof(bytes);
  fclose(file);
  if (failed) {
    return NULL;
  }

  CFDataRef data = CFDataCreate(NULL, bytes, (CFIndex)count);
  if (!data) {
    return NULL;
  }

  SecCertificateRef certificate = SecCertificateCreateWithData(NULL, data);
  CFRelease(data);
  return certificate;
}

int main(int argc, char** argv) {
  if (argc != 4) {
    return 64;
  }
  if (prepare_probe(argv[3]) < 0) {
    return 65;
  }

  int result = 66;
  SecCertificateRef leaf = read_certificate(argv[1]);
  SecCertificateRef root = read_certificate(argv[2]);
  SecPolicyRef policy = NULL;
  SecTrustRef trust = NULL;
  CFArrayRef anchors = NULL;
  CFErrorRef error = NULL;
  if (!leaf || !root) {
    goto out;
  }

  result = 67;
  policy = SecPolicyCreateBasicX509();
  if (!policy || SecTrustCreateWithCertificates(leaf, policy, &trust) != errSecSuccess) {
    goto out;
  }

  result = 68;
  anchors = CFArrayCreate(NULL, (const void**)&root, 1, &kCFTypeArrayCallBacks);
  if (!anchors || SecTrustSetAnchorCertificates(trust, anchors) != errSecSuccess ||
      SecTrustSetAnchorCertificatesOnly(trust, true) != errSecSuccess ||
      SecTrustSetNetworkFetchAllowed(trust, true) != errSecSuccess) {
    goto out;
  }

  Boolean trusted = SecTrustEvaluateWithError(trust, &error);
  printf("{\"event\":\"trust-evaluation\",\"trusted\":%s,\"error\":%ld}\n",
         trusted ? "true" : "false", error ? CFErrorGetCode(error) : 0L);
  result = 0;

out:
  if (error) {
    CFRelease(error);
  }
  if (anchors) {
    CFRelease(anchors);
  }
  if (trust) {
    CFRelease(trust);
  }
  if (policy) {
    CFRelease(policy);
  }
  if (root) {
    CFRelease(root);
  }
  if (leaf) {
    CFRelease(leaf);
  }
  return result;
}
