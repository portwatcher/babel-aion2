# Kubernetes runtime recovery

`@babel/runtime-recovery` retires a supervised Pod after an entire container
disappears, including its supervisor. It runs separately from web and voice
delivery. A healthy runtime does not depend on its polling loop.

## Admission and evidence

Apply migration `0012_parallel_toad` first. Each supervised Pod must receive its
immutable UID, name and namespace through Downward API environment variables
`BABEL_RUNTIME_POD_UID`, `BABEL_RUNTIME_POD_NAME` and
`BABEL_RUNTIME_POD_NAMESPACE`. Partial or invalid configuration prevents startup.
Ordinary non-Kubernetes process supervision may omit all three variables.

Before forking a child, the supervisor reserves its runtime owner under a locked
`runtime_pod` record. Only one unconfirmed owner may belong to that Pod. A
surviving supervisor can close its old child's owner and restart normally. A new
supervisor in the same Pod cannot attest to the old child's death: it persists a
retirement request and starts no delivery child. A retry with the same reserved
owner ID remains idempotent.

Deployment Pod templates must include both:

- Label `babel.juryquinn.com/supervised: 'true'`.
- Finalizer `babel.juryquinn.com/runtime-ownership`.

The finalizer must exist at creation. It retains the API object while the
controller persists its shutdown evidence. The controller polls only managed
Pods in its configured namespace. A retirement request causes an ordinary
graceful deletion with UID and resource-version preconditions. It never uses a
force deletion or zero grace period.

For a deleting Pod, the controller first seals admission under the same row lock
used by runtime registration. If all registered owners have their normal
supervisor exit receipts, or no owner was ever admitted, the barrier can retire
without inventing a physical Pod exit. A late reservation cannot start a child.

Otherwise the Pod must be terminal and every regular, init and ephemeral
container must have a current terminated status: matching nonempty container ID,
valid start/finish timestamps, exit code, and a supported runtime reason
(`Completed`, `Error` or `OOMKilled`). `lastState`, a missing Pod, elapsed time,
`NodeLost`, terminal phase alone and `ContainerStatusUnknown` do not qualify.
Kubernetes can synthesize exit code 137 when it cannot locate a container; that
is not a receipt. The guard follows the
[deployed Kubernetes conversion contract](https://github.com/kubernetes/kubernetes/blob/v1.34.1/pkg/kubelet/kubelet_pods.go).

Verified evidence closes only that Pod's runtime owners and their registered
player sockets, media peers and source runs in one database transaction. Existing
owner locks fence delayed registrations. The controller then conditionally
removes only its own finalizer, preserving other finalizers. UID/resource-version
conflicts retry from a fresh read. A DB outage leaves the finalizer and unknown
receipts intact. Historical owners with no Pod identity remain untouched.

## Private deployment

The web image contains `recovery/index.mjs`; run it as a separate Deployment with
`node recovery/index.mjs`. It needs only `DATABASE_URL`, its namespace through
`BABEL_RUNTIME_POD_NAMESPACE`, and Kubernetes' projected service-account token/CA.
It reads the token for each request so token rotation works. It uses one database
connection, polls every two seconds and bounds storage/API requests to five
seconds. `/health/live` and `/health/ready` listen on port 3200; no public Service
or management endpoint is required.

Use namespace-scoped Pod `get`, `list`, `patch` and `delete` permissions. Grant no
Secret access or cluster-wide Pod permissions. Keep service-account tokens out
of web and voice containers. Allow only the controller's Kubernetes API egress
in addition to established database/DNS policies. Do not mount bot credentials,
provider encryption keys or administrator secrets into the controller.

Order GitOps resources so migrations finish before recovery, then start managed
web/voice Pods. Releases update the controller with the same immutable web image.
Include its one-connection pool, and any rollout overlap, in the database budget.
Do not roll managed runtimes back to a version that ignores Pod admission while
retirement requests remain. Stop and confirm their delivery before rollback.

## Limits and local reproduction

This recovery relies on trustworthy kubelet/container-runtime termination
evidence. An unavailable host, missing object or status that never becomes known
still requires independent host fencing before its unknown owners can be closed.
Never remove a production finalizer or edit receipts to bypass that requirement.
See Kubernetes' [finalizer semantics](https://kubernetes.io/docs/concepts/overview/working-with-objects/finalizers/).

The destructive local smoke test requires a dedicated two-node Docker minikube
profile, with no workloads other than `kube-system`. It verifies the profile,
nodes, namespace labels and exact container ID before terminating any container.
It creates generated credentials and fixture data, temporarily suspends only the
test worker's kubelet, and removes its namespace afterward. It never uses the
default kubectl context or production secrets.

```sh
docker build --target runtime -t babel-runtime-proof:web-candidate .
docker build --target voice-worker -t babel-runtime-proof:voice-candidate .
minikube start -p babel-recovery-local --driver=docker --container-runtime=containerd --nodes=2 --cpus=2 --memory=2048 --keep-context
minikube -p babel-recovery-local image load babel-runtime-proof:web-candidate
minikube -p babel-recovery-local image load babel-runtime-proof:voice-candidate
node scripts/kubernetes-recovery-smoke.mjs babel-recovery-local babel-runtime-proof:web-candidate babel-runtime-proof:voice-candidate
minikube delete -p babel-recovery-local
```

The web regression uses actual authenticated sockets and a second surviving
replica. A stopped controller keeps same-nickname entry waiting after SIGKILL;
restoring the controller must persist kubelet evidence and release it. The
unknown-status case deliberately simulates Kubernetes `Failed/137` status while
the original socket is still alive. It must remain unconfirmed until actual
shutdown. The worker case allocates a real media peer, terminates the container
and checks scoped closure plus a new offer in the existing listener generation.
This is container lifecycle evidence, not Discord speech, connected WebRTC audio,
production host-failure or network-performance evidence.
