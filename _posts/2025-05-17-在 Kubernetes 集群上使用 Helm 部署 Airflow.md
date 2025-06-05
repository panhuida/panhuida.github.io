---
title: 在 Kubernetes 集群上使用 Helm 部署 Airflow
description: >-
  记录在 Kubernetes 集群上使用 Helm 部署 Airflow
author: panhuida
date: 2025-06-05 15:41 +0800
categories: [Blog, Tutorial]
tags: [homelab]
pin: true
media_subpath: /assets/img
---



为了在 Kubernetes 使用 Airflow，[在本地 （迷你主机）搭建 Kubernetes 集群](https://mp.weixin.qq.com/s/o8hkHbvNZ8P9EWf4t8VUkQ)，然后使用 Helm 部署 Airflow。

Kubernetes 是**容器编排**，Airflow 是**任务编排**。



### 01 介绍

Apache Airflow（或简称 Airflow）是一个以编程方式编写、调度和监控工作流的平台，广泛用于数据工程和分析。

在 Kubernetes 上运行 Airflow 为管理分布式工作负载提供了可扩展性和灵活性，而 Helm 则简化了部署过程。

直接从 GitHub 存储库同步 DAG，便于版本控制、团队成员之间的无缝协作，以及实现 CI/CD 。



本文记录的是在本地 Kubernetes 集群中使用 Helm 部署 Airflow 。使用的是官方 Airflow Helm Chart，对于values.yaml，主要的改动配置如下：

- Apache Airflow Helm Chart 1.16.0 中的 storageClassName 默认配置是空的，即使用 K8s 默认的StorageClass，需要为 K8s 配置PV，此次使用的Local Path Provisioner；
- Apache Airflow Helm Chart 1.16.0 默认使用容器PostgreSQL，此次改为使用本地已经安装的 PostgreSQL；
- 配置 Airflow 从 GitHub 存储库自动同步 DAG；
- 将任务日志保存到 minio ( 共享存储 ) 。



本文中的软件版本

- Kubernetes:  v1.32.3

- Helm:  v3.17.2

- Airflow Helm Chart: v1.16.0  ( Airflow 的版本为 v2.10.15 )

本文的源码仓库（此仓库保存了github 的个人访问令牌，故没有开放）

https://github.com/panhuida/airflow-dags-demo

本文带目录导航的版本

https://panhuida.github.io/





### 02 操作步骤

#### 1. 在 K8s 配置 PV - Local Path Provisioner

https://github.com/rancher/local-path-provisioner

https://kubernetes.io/zh-cn/docs/concepts/storage/volumes/#local

https://blog.csdn.net/MssGuo/article/details/132120705

https://time.geekbang.org/column/article/542376

Kubernetes 集群安装，详见之前的文章[《在 Ubuntu 24.04 中使用 kubeadm 安装 Kubernetes》](https://mp.weixin.qq.com/s/o8hkHbvNZ8P9EWf4t8VUkQ)。

Apache Airflow Helm Chart 1.16.0 中的 storageClassName 默认配置是空的，即使用 K8s 默认的StorageClass，需要为 K8s 配置PV，并设置默认的StorageClass，此次使用的 Local Path Provisioner。

```shell
# 安装
ubuntu@node1:~$ kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
# 查看 pod
ubuntu@node1:~$ kubectl get pods -n local-path-storage
NAME                                     READY     STATUS    RESTARTS   AGE
local-path-provisioner-d744ccf98-xfcbk   1/1       Running   0          7m
# 查看 storageclass
ubuntu@node1:~$ kubectl get storageclass
NAME         PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
local-path   rancher.io/local-path   Delete          WaitForFirstConsumer   false                  14h
# 实时查看 pod 日志
ubuntu@node1:~$ kubectl logs -f -l app=local-path-provisioner -n local-path-storage

# 将 local-path 设置 kubernetes的默认 StorageClass
ubuntu@node1:~$ kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
# 取消
#kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'


# 使用
# 基于 https://raw.githubusercontent.com/rancher/local-path-provisioner/master/examples/pvc/pvc.yaml 的内容定制
ubuntu@node1:~$ vim pvc.yaml
ubuntu@node1:~$ kubectl create -f pvc.yaml



# 测试 (可选) 
# 基于 https://raw.githubusercontent.com/rancher/local-path-provisioner/master/examples/pod/pod.yaml 的内容定制
ubuntu@node1:~$ vim pod.yaml
ubuntu@node1:~$ kubectl create -f pod.yaml
ubuntu@node1:~$ kubectl get pv
ubuntu@node1:~$ kubectl get pvc
ubuntu@node1:~$ kubectl get pod
ubuntu@node1:~$ kubectl exec volume-test -- sh -c "echo local-path-test > /data/test"
# 删除测试
ubuntu@node1:~$ kubectl delete -f pod.yaml
ubuntu@node1:~$ kubectl create -f pod.yaml
ubuntu@node1:~$ kubectl exec volume-test -- sh -c "cat /data/test"
local-path-test
# 可以 pod 所在节点的目录查看数据
#ubuntu@node1:~$ kubectl get pods -A
ubuntu@node1:~$ kubectl get pod volume-test -o wide
ubuntu@node2:~$ cd /opt
ubuntu@node2:/opt$ ls
ubuntu@node2:/opt$ cd local-path-provisioner/
ubuntu@node2:/opt/local-path-provisioner$ ls
# 删除 pod
ubuntu@node1:~$ kubectl delete -f pod.yaml
# 删除 PVC
ubuntu@node1:~$ kubectl delete pvc local-path-pvc -n default

```

输出示例

```shell
ubuntu@node1:~$ kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
namespace/local-path-storage created
serviceaccount/local-path-provisioner-service-account created
role.rbac.authorization.k8s.io/local-path-provisioner-role created
clusterrole.rbac.authorization.k8s.io/local-path-provisioner-role created
rolebinding.rbac.authorization.k8s.io/local-path-provisioner-bind created
clusterrolebinding.rbac.authorization.k8s.io/local-path-provisioner-bind created
deployment.apps/local-path-provisioner created
storageclass.storage.k8s.io/local-path created
configmap/local-path-config created
(
https://claude.ai/chat/60bc953f-b061-47b4-906c-1bc87e927a56
Namespace：创建一个名为"local-path-storage"的命名空间，用于隔离和组织相关资源。
Deployment：部署local-path-provisioner容器。使用rancher/local-path-provisioner.0.31镜像。
StorageClass：定义名为"local-path"的存储类。
)

# 设置默认 storageclass
ubuntu@node1:~$ kubectl get storageclass
NAME         PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
local-path   rancher.io/local-path   Delete          WaitForFirstConsumer   false                  15h
ubuntu@node1:~$ kubectl patch storageclass local-path -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
storageclass.storage.k8s.io/local-path patched
ubuntu@node1:~$ kubectl get storageclass
NAME                   PROVISIONER             RECLAIMPOLICY   VOLUMEBINDINGMODE      ALLOWVOLUMEEXPANSION   AGE
local-path (default)   rancher.io/local-path   Delete          WaitForFirstConsumer   false                  15h
```

配置文件示例

```shell
https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: local-path
provisioner: rancher.io/local-path
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Delete
(
https://claude.ai/chat/60bc953f-b061-47b4-906c-1bc87e927a56
StorageClass：定义名为"local-path"的存储类:
使用"rancher.io/local-path"作为供应商
设置为"WaitForFirstConsumer"绑定模式（直到Pod被调度才分配存储）
设置"Delete"回收策略（当PVC被删除时也删除相应的PV）
)


https://raw.githubusercontent.com/rancher/local-path-provisioner/master/examples/pvc/pvc.yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: local-path-pvc
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: local-path
  resources:
    requests:
      storage: 1024Mi


kubectl create -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/examples/pod/pod.yaml
apiVersion: v1
kind: Pod
metadata:
  name: volume-test
spec:
  containers:
  - name: volume-test
    image: nginx:stable-alpine
    imagePullPolicy: IfNotPresent
    volumeMounts:
    - name: volv
      mountPath: /data
    ports:
    - containerPort: 80
  volumes:
  - name: volv
    persistentVolumeClaim:
      claimName: local-path-pvc
```



#### 2. 在 PostgreSQL 创建 Airflow 用户

PostgreSQL 安装，详见之前的文章[《在本地搭建 Data Lakehouse 测试、学习环境》](https://mp.weixin.qq.com/s/lbPMmtUubUbbLmDmnTQ09A)。

Apache Airflow Helm Chart 1.16.0 默认使用容器 PostgreSQL，此次改为使用本地已经安装的 PostgreSQL。

```shell
# 登录
psql -h localhost -U postgres

# 创建 Airflow 用户
CREATE USER airflow_k8s WITH PASSWORD 'airflow_k8s';
create database airflow_k8s with owner airflow_k8s;
```





#### 3. 在 Minio 创建 Airflow 存储桶

https://airflow.apache.org/docs/apache-airflow-providers-amazon/stable/logging/s3-task-handler.html

https://blog.min.io/apache-airflow-minio/

Minio 安装，详见之前的文章[《在本地搭建 Data Lakehouse 测试、学习环境》](https://mp.weixin.qq.com/s/lbPMmtUubUbbLmDmnTQ09A)。

在 Minio 创建存储桶 airflow，并创建文件夹 logs，用于保存 Airflow 的任务日志（ Airflow 的组件及任务以 pod 的方式运行，需要把日志保存到共享存储，minio 作为共享存储）。



#### 4. 在 github 创建存储库和配置个人访问令牌(PAT)

在 github 中， 创建保存 Airflow 的 DAG 的存储库 airflow-dags-demo，并配置 个人访问令牌(PAT) 。

将 个人访问令牌 进行 Base64 编码，后面在 Airflow 从 存储库 airflow-dags-demo 同步 DAG 的配置中会用到。

https://www.base64encode.org/



#### 5. 在 K8s 部署 Airflow

https://airflow.apache.org/docs/helm-chart/stable/index.html

https://artifacthub.io/packages/helm/apache-airflow/airflow

##### （1）创建 Airflow 的命名空间

value.yaml 中的有些配置是从 Kubernetes Secret 引入的，而创建 Kubernetes Secret 需要指定命名空间，故先为 Airflow 创建命名空间 airflow

```shell
ubuntu@node1:~$ kubectl get namespaces
# ubuntu@node1:~$ kubectl delete namespace airflow
ubuntu@node1:~$ kubectl create namespace airflow
namespace/airflow created
```



##### （2）使用 git-sync 同步 DAG 文件 的 K8s 配置

使用  git-sync 的方式，同步Airflow DAG 文件，如下是 K8s 的相关配置。

**1️⃣K8s 配置 git_secrets**

```shell
ubuntu@node1:~$ vim git_secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: git-credentials
  namespace: airflow
data:
  # For git-sync v3
  GIT_SYNC_USERNAME: cGFuaHVpZGE=
  GIT_SYNC_PASSWORD: Z2l0aHViX3BhdF8xMUFGSkVNQkEwZ083enN0VGdjanhqXzdKWW5SbUNHTzV4TkJBanByV0hwSk5NSVBqOGt0N201UFVKaUZVTktJVVlFSFFSTFBRQkRtUGI1T1Yx
  # For git-sync v4
  GITSYNC_USERNAME: cGFuaHVpZGE=
  GITSYNC_PASSWORD: Z2l0aHViX3BhdF8xMUFGSkVNQkEwZ083enN0VGdjanhqXzdKWW5SbUNHTzV4TkJBanByV0hwSk5NSVBqOGt0N201UFVKaUZVTktJVVlFSFFSTFBRQkRtUGI1T1Yx


ubuntu@node1:~$ kubectl apply -f git_secrets.yaml
secret/git-credentials created

ubuntu@node1:~$ kubectl get secrets git-credentials -n airflow
NAME              TYPE     DATA   AGE
git-credentials   Opaque   4      72s
```



**2️⃣为 git-sync 配置代理**

访问 github 存储库可能出现问题，故配置代理访问。

```shell
ubuntu@node1:~$ kubectl create secret generic proxy-config \
  --from-literal=HTTPS_PROXY="http://192.168.31.72:7890" \
  --from-literal=HTTP_PROXY="http://192.168.31.72:7890" \
  --from-literal=NO_PROXY="localhost,127.0.0.1/8,10.0.0.0/8,192.168.0.0/16" \
  -n airflow
  
ubuntu@node1:~$ kubectl get secrets proxy-config -n airflow
NAME           TYPE     DATA   AGE
proxy-config   Opaque   3      7s
```





##### （3）部署 Airflow

```shell
# 配置代理
ubuntu@node1:~$ export HTTP_PROXY=http://192.168.31.72:7890/
ubuntu@node1:~$ export HTTPS_PROXY=http://192.168.31.72:7890/

# 添加 apache-airflow 仓库
ubuntu@node1:~$ helm repo add apache-airflow https://airflow.apache.org


# 修改 Airflow Helm Chart 配置文件
# Airflow Helm Chart 配置文件来源
# https://artifacthub.io/packages/helm/apache-airflow/airflow?modal=values
# https://github.com/apache/airflow/blob/main/chart/values.yaml
ubuntu@node1:~$ vim values-airflow.yaml
# 对于需要全新安装，建议设置为 true
# https://airflow.apache.org/docs/helm-chart/stable/index.html#naming-conventions
useStandardNaming: true

# 界面上可以查看 Airflow 配置文件内容
# https://airflow.apache.org/docs/helm-chart/stable/airflow-configuration.html
config:
  webserver:
    expose_config: 'True'  # by default this is 'False'
    
# 保留 DAG 示例，在 Airflow 的界面上可以查看 DAG 示例
# https://airflow.apache.org/docs/helm-chart/stable/airflow-configuration.html
extraEnv: |
  - name: AIRFLOW__CORE__LOAD_EXAMPLES
    value: 'True'
    
# 开启测试连接选项，在 Airflow 的界面上增加连接时，可以测试连接是否能通
    test_connection: "Enabled" 

# airflow 的元数据库使用外部 PostgreSQL 数据库
# https://airflow.apache.org/docs/helm-chart/stable/production-guide.html#database
# 不创建pg容器 
postgresql:
  enabled: false
# 连接  
  metadataConnection:
    user: airflow_k8s
    pass: airflow_k8s
    protocol: postgresql
    host: 192.168.31.72
    port: 5432
    db: airflow_k8s
    sslmode: disable

# 使用 PV Local Path Provisioner
# 有状态的组件 scheduler、triggerer、worker、redis
# storageClassName 默认为空，使用kubernetes的默认StorageClass，按需修改空间大小和storageClassName
size: 1Gi
#storageClassName: "local-path"
   
# 配置执行器
executor: "LocalKubernetesExecutor"

# 配置 DAG
# 使用 git-sync 同步 DAG，使用没有持久化存储的git-sync
# https://airflow.apache.org/docs/helm-chart/stable/manage-dag-files.html#mounting-dags-using-git-sync-sidecar-without-persistence
# https://medium.com/apache-airflow/shared-volumes-in-airflow-the-good-the-bad-and-the-ugly-22e9f681afca
  gitSync:
    enabled: true
    repo: https://github.com/panhuida/airflow-dags-demo.git
    branch: main
    rev: HEAD
    # The git revision (branch, tag, or hash) to check out, v4 only
    ref: main
    depth: 1
    # the number of consecutive failures allowed before aborting
    maxFailures: 3
    # subpath within the repo where dags are located
    # should be "" if dags are at repo root
    subPath: "airflow/dags"
    credentialsSecret: git-credentials
    # 从 github 拉取 DAG 的时间间隔
    period: 600s

# 为 git-sync 配置代理，引入代理的配置
    envFrom: |
      - secretRef:
          name: 'proxy-config'
    
    
# 配置远程日志存储，后面在 Airflow 界面上配置 minio 的连接 minio_default
# 开启持久化卷 或 配置远程日志存储，这里选择配置远程日志存储，为了可以查看 K8s 的任务 Pod 运行的日志
# https://airflow.apache.org/docs/helm-chart/stable/manage-logs.html
# https://airflow.apache.org/docs/apache-airflow-providers-amazon/stable/logging/s3-task-handler.html
config:
  core:
    dags_folder: '{{ include "airflow_dags" . }}'
    # This is ignored when used with the official Docker image
    load_examples: 'False'
    executor: '{{ .Values.executor }}'
    # For Airflow 1.10, backward compatibility; moved to [logging] in 2.0
    colored_console_log: 'False'
    # remote_logging: '{{- ternary "True" "False" (or .Values.elasticsearch.enabled .Values.opensearch.enabled) }}'
    auth_manager: "airflow.providers.fab.auth_manager.fab_auth_manager.FabAuthManager"
    test_connection: "Enabled"
  logging:
    # remote_logging: '{{- ternary "True" "False" (or .Values.elasticsearch.enabled .Values.opensearch.enabled) }}'
    colored_console_log: 'False'
    remote_logging: "True"
    remote_base_log_folder: "s3://airflow/logs"
    remote_log_conn_id: "minio_default"


# 配置 webserver-secret-key
# https://airflow.apache.org/docs/helm-chart/stable/production-guide.html#webserver-secret-key
ubuntu@node1:~$ kubectl create secret generic my-webserver-secret --from-literal="webserver-secret-key=$(python3 -c 'import secrets; print(secrets.token_hex(16))')"  -n airflow
ubuntu@node1:~$ kubectl get secret my-webserver-secret -n airflow
ubuntu@node1:~$ vim values-airflow.yaml
webserverSecretKeySecretName: my-webserver-secret


# 使用 airflow Chart 部署名为 airflow 的 Helm Release
ubuntu@node1:~$ helm upgrade --install airflow apache-airflow/airflow --namespace airflow --create-namespace --values ./values-airflow.yaml --debug
# 修改配置等，使用如下命令部署
helm upgrade airflow apache-airflow/airflow -n airflow -f values-airflow.yaml


# 在 node1 执行的话，使用 node1 的ip访问 Web UI
ubuntu@node1:~$ kubectl port-forward --address 0.0.0.0 svc/airflow-webserver 8890:8080 --namespace airflow
使用 node1 的ip访问 Web UI
http://10.227.94.45:8890



# 重新安装
# 本地测试，可能多次重新安装，将 fernet_key 配置到 value.yaml 中，避免 Airflow 配置的连接出现问题
ubuntu@node1:~$ echo Fernet Key: $(kubectl get secret --namespace airflow airflow-fernet-key -o jsonpath="{.data.fernet-key}" | base64 --decode)
Fernet Key: dEhHTzUybEFNOW1qNnhSZ1RyV3VNSW9UeXU0WElQUXg=
ubuntu@node1:~$ vim values-airflow.yaml
config:
  core:
    fernet_key: dEhHTzUybEFNOW1qNnhSZ1RyV3VNSW9UeXU0WElQUXg=
# 配置代理
export HTTP_PROXY=http://192.168.31.72:7890/
export HTTPS_PROXY=http://192.168.31.72:7890/
# 卸载旧 Release（彻底清除资源）
kubectl get pods -A
helm uninstall airflow -n airflow
kubectl get pods -A
kubectl delete all --all -n airflow
# 手动删除残留 PVC（确认无重要数据）
kubectl get pvc -A
kubectl get pvc -n airflow
kubectl delete pvc logs-airflow-triggerer-0 -n airflow
kubectl delete pvc -n airflow --all
# 安装
helm upgrade --install airflow apache-airflow/airflow --namespace airflow --create-namespace --values ./values-airflow.yaml --debug
```

输出示例

```shell
ubuntu@node1:~$ helm upgrade --install airflow apache-airflow/airflow --namespace airflow --create-namespace --values ./values-airflow.yaml --debug
NOTES:
Thank you for installing Apache Airflow 2.10.5!

Your release is named airflow.
You can now access your dashboard(s) by executing the following command(s) and visiting the corresponding port at localhost in your browser:

Airflow Webserver:     kubectl port-forward svc/airflow-webserver 8080:8080 --namespace airflow
Default Webserver (Airflow UI) Login credentials:
    username: admin
    password: admin

You can get Fernet Key value by running the following:

    echo Fernet Key: $(kubectl get secret --namespace airflow airflow-fernet-key -o jsonpath="{.data.fernet-key}" | base64 --decode)



# Airflow executor 默认为 CeleryExecutor
# executor 为 CeleryExecutor 的 pod 清单
ubuntu@node1:~$ kubectl get pods -n airflow
NAME                                 READY   STATUS    RESTARTS   AGE
airflow-redis-0                      1/1     Running   0          13h
airflow-scheduler-6ff76968b5-6687h   2/2     Running   0          13h
airflow-statsd-75fdf4bc64-cv9g4      1/1     Running   0          13h
airflow-triggerer-0                  2/2     Running   0          13h
airflow-webserver-f795c9dff-6r2x5    1/1     Running   0          13h
airflow-worker-0                     2/2     Running   0          13h

# executor 为 KubernetesExecutor 的 pod 清单
ubuntu@node1:~$ kubectl get pods -n airflow
NAME                                              READY   STATUS    RESTARTS       AGE
airflow-scheduler-8759f77cc-9g7tk                 3/3     Running   3 (114s ago)   16m
airflow-statsd-75fdf4bc64-tbms2                   1/1     Running   1 (114s ago)   16m
airflow-triggerer-0                               3/3     Running   3 (114s ago)   16m
airflow-webserver-6bcbf76b9-ww8sf                 1/1     Running   1 (114s ago)   16m


# executor 为 LocalKubernetesExecutor 的 pod 清单
ubuntu@node1:~$ kubectl get pods -n airflow
NAME                                 READY   STATUS    RESTARTS   AGE
airflow-scheduler-0                  2/2     Running   0          25m
airflow-statsd-75fdf4bc64-cv9g4      1/1     Running   0          21h
airflow-triggerer-0                  2/2     Running   0          25m
airflow-webserver-7b7d4bcf64-gg5fc   1/1     Running   0          9m5s
```



##### （4）在 Airflow 界面上增加 minio 的连接

https://airflow.apache.org/docs/apache-airflow-providers-amazon/9.2.0/connections/aws.html

在 Airflow 界面上增加 minio 的连接 minio_default，直接保存而不测试，测试会报异常，这个异常不影响使用（保存日志到 minio ）。

```shell
Connection Id: minio_default
Connection Type: Amazon Web Services
AWS Access Key ID: QNbVk0LrGCOUNviswayw
AWS Secret Access Key: nLmDKpMnCunZn9UAqf1nSDL279GfA5DaPKduR8st
Extra: 
{
  "region name": "us-east-1",
  "endpoint_url": "http://192.168.31.72:9000",
  "verify": false
}
```





### 03 测试

#### 1. 以 官方文档 的示例为例

https://airflow.apache.org/docs/apache-airflow/2.10.5/tutorial/fundamentals.html

##### （1）DAG 文件

tutorial.py

```python
import textwrap
from datetime import datetime, timedelta
import time

from airflow.models.dag import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.python import PythonOperator

def heavy_task():
    # 模拟需要大量资源的操作
    time.sleep(300)
    return "资源密集型任务完成"


with DAG(
    "tutorial_test_20250410",
    # These args will get passed on to each operator
    # You can override them on a per-task basis during operator initialization
    default_args={
        "depends_on_past": False,
        "email": ["panhuida@qq.com"],
        "email_on_failure": False,
        "email_on_retry": False,
        "retries": 1,
        "retry_delay": timedelta(minutes=5),
        # 'queue': 'bash_queue',
        # 'pool': 'backfill',
        # 'priority_weight': 10,
        # 'end_date': datetime(2016, 1, 1),
        # 'wait_for_downstream': False,
        # 'sla': timedelta(hours=2),
        # 'execution_timeout': timedelta(seconds=300),
        # 'on_failure_callback': some_function, # or list of functions
        # 'on_success_callback': some_other_function, # or list of functions
        # 'on_retry_callback': another_function, # or list of functions
        # 'sla_miss_callback': yet_another_function, # or list of functions
        # 'on_skipped_callback': another_function, #or list of functions
        # 'trigger_rule': 'all_success'
    },
    description="A simple tutorial DAG",
    # schedule=timedelta(days=1),
    # UTC 时间，凌晨 2:05
    schedule="5 18 * * *",
    start_date=datetime(2025, 4, 10, 18, 21),
    catchup=False,
    tags=["demo","test"]
) as dag:
    t1 = BashOperator(
        task_id="print_date",
        bash_command="date"
    )

    t2 = BashOperator(
        task_id="sleep",
        depends_on_past=False,
        bash_command="sleep 60",
        retries=3,        
    )

    t1.doc_md = textwrap.dedent(
        """\
        #### Task Documentation
        You can document your task using the attributes `doc_md` (markdown),
        `doc` (plain text), `doc_rst`, `doc_json`, `doc_yaml` which gets
        rendered in the UI's Task Instance Details page.
        ![img](https://imgs.xkcd.com/comics/fixing_problems.png)
        **Image Credit:** Randall Munroe, [XKCD](https://xkcd.com/license.html)
        """
    )

    dag.doc_md = __doc__  # providing that you have a docstring at the beginning of the DAG; OR
    dag.doc_md = """
    This is a documentation placed anywhere
    """  # otherwise, type it like this
    templated_command = textwrap.dedent(
        """
    {% for i in range(5) %}
        echo "{{ ds }}"
        echo "{{ macros.ds_add(ds, 7)}}"
    {% endfor %}
    """
    )

    t3 = BashOperator(
        task_id="templated",
        depends_on_past=False,
        bash_command=templated_command,
    )

    # 测试 local 执行器执行的效果
    t4 = PythonOperator(
        task_id = "heavy_task_local",
        python_callable=heavy_task
    )    

    # 测试 kubernetes 执行器执行的效果
    t5 = PythonOperator(
        task_id = "heavy_task_kubernetes",
        python_callable=heavy_task,
        queue="kubernetes"
    )


    t1 >> [t2, t3, t4] >> t5
```

(

在 LocalKubernetesExecutor 环境下让任务在 Kubernetes Pod 中运行的两种方式：

- 使用 queue 参数来分类和调度任务，为大部分任务提供一个合理的默认 Kubernetes Pod 配置；
- 对于少数有特殊需求的任务，使用 executor_config 来覆盖默认配置，实现精确的定制，如需要 GPU 资源（或者特定的高内存/CPU 资源），使用不同的 Docker 镜像，并调度到带有 GPU 的节点上。

https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/kubernetes_executor.html

https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/kubernetes_executor.html#concepts-pod-override

https://chatgpt.com/c/6840f20e-9b6c-8012-84e6-ac6ee9a77eb2

```python
    t5 = PythonOperator(
        task_id="kubernetes_executor_task",
        python_callable=heavy_task,
        executor_config={
            "pod_override": {
                "spec": {
                    "containers": [
                        {
                            "name": "base",  # 必须为 "base"
                            "image": "python:3.8-slim",
                            "resources": {
                                "requests": {
                                    "memory": "256Mi",
                                    "cpu": "200m",
                                },
                                "limits": {
                                    "memory": "512Mi",
                                    "cpu": "500m",
                                },
                            },
                            "env": [
                                {"name": "ENV_INFO", "value": "Running in KubernetesExecutor"}
                            ],
                        }
                    ]
                }
            }
        },
    )
```

)



##### （2）运行情况

Airflow 界面

![image-20250604215752359](2025-05-17-在 Kubernetes 集群上使用 Helm 部署 Airflow.assets/image-20250604215752359.png)

K8s 中的 pod

```shell
# Airflow executor 为 KubernetesExecutor
# 任务都是以 pod 执行的，pod 的创建顺序是按 Workflow 中的顺序
ubuntu@node1:~$ kubectl get pods -A
NAMESPACE            NAME                                         READY   STATUS    RESTARTS          AGE
airflow              airflow-scheduler-868cd96b8b-7njff           3/3     Running   0                 3m15s
airflow              airflow-statsd-75fdf4bc64-j4d9w              1/1     Running   0                 4h3m
airflow              airflow-triggerer-0                          3/3     Running   0                 92m
airflow              airflow-webserver-84965b76c6-qcdzh           1/1     Running   0                 4h3m

airflow              tutorial-test-20250410-print-date-2oy89l3g   1/1     Running   0                 13s

airflow              tutorial-test-20250410-heavy-task-local-vg4d4mr8   1/1     Running   0                 11s
airflow              tutorial-test-20250410-sleep-ly34j42j              1/1     Running   0                 12s
airflow              tutorial-test-20250410-templated-64ag7g9u          1/1     Running   0                 12s

airflow              tutorial-test-20250410-heavy-task-kubernetes-fx5c76ma   1/1     Running   0                 19s

# Airflow executor 为 LocalKubernetesExecutor
# https://airflow.apache.org/docs/apache-airflow-providers-cncf-kubernetes/stable/local_kubernetes_executor.html
# 只有设置队列（ queue="kubernetes"）的任务是以 pod 执行的
ubuntu@node1:~$ kubectl get pods -A
NAMESPACE            NAME                                                    READY   STATUS    RESTARTS          AGE
airflow              airflow-scheduler-0                                     3/3     Running   0                 7m20s
airflow              airflow-statsd-75fdf4bc64-j4d9w                         1/1     Running   0                 4h54m
airflow              airflow-triggerer-0                                     3/3     Running   0                 7m17s
airflow              airflow-webserver-c85bcfbd5-4f4jr                       1/1     Running   0                 7m20s
airflow              tutorial-test-20250410-heavy-task-kubernetes-fjixx7tq   1/1     Running   0                 27s
```

minio 上的日志示例

![image-20250604220144797](2025-05-17-在 Kubernetes 集群上使用 Helm 部署 Airflow.assets/image-20250604220144797.png)



#### 2. 停止 Airflow、恢复 Airflow

https://gemini.google.com/app/76e8a555d88dcfb2

```shell
# 停止 Airflow 
# 查看 deployments、statefulsets
ubuntu@node1:~$ kubectl get deployments -n airflow
NAME                READY   UP-TO-DATE   AVAILABLE   AGE
airflow-statsd      1/1     1            1           17h
airflow-webserver   1/1     1            1           17h
ubuntu@node1:~$ kubectl get statefulsets -n airflow
NAME                READY   AGE
airflow-scheduler   1/1     17h
airflow-triggerer   1/1     17h
ubuntu@node1:~$ kubectl get pv -n airflow
NAME                                       CAPACITY   ACCESS MODES   RECLAIM POLICY   STATUS   CLAIM                              STORAGECLASS   VOLUMEATTRIBUTESCLASS   REASON   AGE
pvc-0fe86f4f-9921-486c-94c8-47fadaa1f7ac   1Gi        RWO            Delete           Bound    airflow/logs-airflow-triggerer-0   local-path     <unset>                          3d18h
pvc-5186cb4e-6733-4812-b334-17bb2cc153b1   1Gi        RWO            Delete           Bound    airflow/logs-airflow-scheduler-0   local-path     <unset>                          2d21h
pvc-e4ea2cde-f55a-423f-acfc-ab39dae60b77   1Gi        RWO            Delete           Bound    airflow/logs-airflow-worker-0      local-path     <unset>                          3d18h
pvc-e5b1d31b-8379-4599-9260-dbcc8cc3cf63   1Gi        RWO            Delete           Bound    airflow/redis-db-airflow-redis-0   local-path     <unset>                          3d18h

# 缩减 Deployments
kubectl scale deployment airflow-webserver --replicas=0 -n airflow
kubectl scale deployment airflow-statsd --replicas=0 -n airflow
# (如果还有其他 Deployment，也一并缩减)

# 缩减 StatefulSets
kubectl scale statefulset airflow-scheduler --replicas=0 -n airflow
kubectl scale statefulset airflow-triggerer --replicas=0 -n airflow
# (如果还有其他 StatefulSet，也一并缩减)

kubectl get pods -n airflow

# 恢复
# 当你想要重新启动 Airflow 时，只需将副本数重新设置为原来的值（通常是 1 或更多）
kubectl scale deployment airflow-webserver --replicas=1 -n airflow
kubectl scale deployment airflow-statsd --replicas=1 -n airflow

kubectl scale statefulset airflow-scheduler --replicas=1 -n airflow
kubectl scale statefulset airflow-triggerer --replicas=1 -n airflow


kubectl get pods -n airflow
```



#### 3. 关于 DAG 同步

##### （1）手动触发一次 Git 同步

方法 1：

重启 `git-sync` 容器所在 Pod

```shell
kubectl delete pod airflow-scheduler-868cd96b8b-527vp -n airflow
```

重建 Pod 会自动拉取最新 DAG。

方法 2：

临时将 `period` 设置为更小值（例如 30s）

```shell
period: 30s
```

修改后执行：

```shell
helm upgrade airflow apache-airflow/airflow -n airflow -f values.yaml
```



##### （2）查看从 GitHub 同步 DAG 的时间

```shell
ubuntu@node1:~$ kubectl logs airflow-scheduler-868cd96b8b-7njff -n airflow -c git-sync | grep -E "updated successfully|update required" | tail -n 5
{"logger":"","ts":"2025-06-04 13:02:19.029541","caller":{"file":"main.go","line":1775},"level":0,"msg":"update required","ref":"main","local":"82932d19b8e1823d6e8a716d90b0bca741ad1705","remote":"82932d19b8e1823d6e8a716d90b0bca741ad1705","syncCount":0}
{"logger":"","ts":"2025-06-04 13:02:19.079770","caller":{"file":"main.go","line":1821},"level":0,"msg":"updated successfully","ref":"main","remote":"82932d19b8e1823d6e8a716d90b0bca741ad1705","syncCount":1}
```





### 04 问题

#### 1. 任务 pod 中的 git-sync 出现异常

https://chatgpt.com/c/683fad6a-2ac4-8012-bb5f-37a05d85fc9b

```shell
ubuntu@node1:~$ kubectl get pods -n airflow
NAME                                         READY   STATUS     RESTARTS         AGE
airflow-scheduler-657f9d74bb-s69g4           3/3     Running    24 (4h16m ago)   36h
airflow-statsd-75fdf4bc64-9765w              1/1     Running    9 (4h16m ago)    39h
airflow-triggerer-0                          3/3     Running    25 (4h16m ago)   36h
airflow-webserver-795855586d-nvn6j           1/1     Running    9 (4h16m ago)    36h
tutorial-test-20250410-print-date-l0izbrdk   0/1     Init:0/1   0                4m41s


ubuntu@node1:~$ kubectl logs tutorial-test-20250410-print-date-l0izbrdk -n airflow
Defaulted container "base" out of: base, git-sync-init (init)
Error from server (BadRequest): container "base" in pod "tutorial-test-20250410-print-date-l0izbrdk" is waiting to start: PodInitializing


ubuntu@node1:~$ kubectl describe pod tutorial-test-20250410-print-date-l0izbrdk -n airflow
Name:             tutorial-test-20250410-print-date-l0izbrdk
Namespace:        airflow
Priority:         0
Service Account:  airflow-worker
Node:             node2/10.227.94.229
Start Time:       Wed, 04 Jun 2025 10:14:00 +0800
Labels:           airflow-worker=80
                  airflow_version=2.10.5
                  component=worker
                  dag_id=tutorial_test_20250410
                  kubernetes_executor=True
                  release=airflow
                  run_id=scheduled__2025-06-02T1805000000-6d074f9c1
                  task_id=print_date
                  tier=airflow
                  try_number=1
Annotations:      cluster-autoscaler.kubernetes.io/safe-to-evict: false
                  dag_id: tutorial_test_20250410
                  run_id: scheduled__2025-06-02T18:05:00+00:00
                  task_id: print_date
                  try_number: 1
Status:           Pending
IP:               10.244.1.84
IPs:
  IP:  10.244.1.84
Init Containers:
  git-sync-init:
    Container ID:   containerd://efef6df454ad69a1d77d43845e54ab17a802901af62c2031229b819507b0da6a
    Image:          registry.k8s.io/git-sync/git-sync:v4.3.0
    Image ID:       registry.k8s.io/git-sync/git-sync@sha256:5813a7da0ccd58f6dfb9d5e48480e2877355e6bb3d7d81c8908eb1adc3a23b6e
    Port:           <none>
    Host Port:      <none>
    State:          Running
      Started:      Wed, 04 Jun 2025 10:14:00 +0800
    Ready:          False
    Restart Count:  0
    Environment:
      GIT_SYNC_USERNAME:           <set to the key 'GIT_SYNC_USERNAME' in secret 'git-credentials'>  Optional: false
      GITSYNC_USERNAME:            <set to the key 'GITSYNC_USERNAME' in secret 'git-credentials'>   Optional: false
      GIT_SYNC_PASSWORD:           <set to the key 'GIT_SYNC_PASSWORD' in secret 'git-credentials'>  Optional: false
      GITSYNC_PASSWORD:            <set to the key 'GITSYNC_PASSWORD' in secret 'git-credentials'>   Optional: false
      GIT_SYNC_REV:                HEAD
      GITSYNC_REF:                 main
      GIT_SYNC_BRANCH:             main
      GIT_SYNC_REPO:               https://github.com/panhuida/airflow-dags-demo.git
      GITSYNC_REPO:                https://github.com/panhuida/airflow-dags-demo.git
      GIT_SYNC_DEPTH:              1
      GITSYNC_DEPTH:               1
      GIT_SYNC_ROOT:               /git
      GITSYNC_ROOT:                /git
      GIT_SYNC_DEST:               repo
      GITSYNC_LINK:                repo
      GIT_SYNC_ADD_USER:           true
      GITSYNC_ADD_USER:            true
      GITSYNC_PERIOD:              3600s
      GIT_SYNC_MAX_SYNC_FAILURES:  3
      GITSYNC_MAX_FAILURES:        3
      GIT_SYNC_ONE_TIME:           true
      GITSYNC_ONE_TIME:            true
    Mounts:
      /git from dags (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-5hl6t (ro)
Containers:
  base:
    Container ID:  
    Image:         apache/airflow:2.10.5
    Image ID:      
    Port:          <none>
    Host Port:     <none>
    Args:
      airflow
      tasks
      run
      tutorial_test_20250410
      print_date
      scheduled__2025-06-02T18:05:00+00:00
      --local
      --subdir
      DAGS_FOLDER/tutorial.py
    State:          Waiting
      Reason:       PodInitializing
    Ready:          False
    Restart Count:  0
    Environment:
      AIRFLOW__CORE__EXECUTOR:              LocalExecutor
      AIRFLOW__CORE__FERNET_KEY:            <set to the key 'fernet-key' in secret 'airflow-fernet-key'>  Optional: false
      AIRFLOW_HOME:                         /opt/airflow
      AIRFLOW__CORE__SQL_ALCHEMY_CONN:      <set to the key 'connection' in secret 'airflow-metadata'>               Optional: false
      AIRFLOW__DATABASE__SQL_ALCHEMY_CONN:  <set to the key 'connection' in secret 'airflow-metadata'>               Optional: false
      AIRFLOW_CONN_AIRFLOW_DB:              <set to the key 'connection' in secret 'airflow-metadata'>               Optional: false
      AIRFLOW__WEBSERVER__SECRET_KEY:       <set to the key 'webserver-secret-key' in secret 'my-webserver-secret'>  Optional: false
      AIRFLOW__CORE__LOAD_EXAMPLES:         True
      AIRFLOW_IS_K8S_EXECUTOR_POD:          True
    Mounts:
      /opt/airflow/airflow.cfg from config (ro,path="airflow.cfg")
      /opt/airflow/config/airflow_local_settings.py from config (ro,path="airflow_local_settings.py")
      /opt/airflow/dags from dags (ro)
      /opt/airflow/logs from logs (rw)
      /var/run/secrets/kubernetes.io/serviceaccount from kube-api-access-5hl6t (ro)
Conditions:
  Type                        Status
  PodReadyToStartContainers   True 
  Initialized                 False 
  Ready                       False 
  ContainersReady             False 
  PodScheduled                True 
Volumes:
  dags:
    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)
    Medium:     
    SizeLimit:  <unset>
  logs:
    Type:       EmptyDir (a temporary directory that shares a pod's lifetime)
    Medium:     
    SizeLimit:  <unset>
  config:
    Type:      ConfigMap (a volume populated by a ConfigMap)
    Name:      airflow-config
    Optional:  false
  kube-api-access-5hl6t:
    Type:                    Projected (a volume that contains injected data from multiple sources)
    TokenExpirationSeconds:  3607
    ConfigMapName:           kube-root-ca.crt
    ConfigMapOptional:       <nil>
    DownwardAPI:             true
QoS Class:                   BestEffort
Node-Selectors:              <none>
Tolerations:                 node.kubernetes.io/not-ready:NoExecute op=Exists for 300s
                             node.kubernetes.io/unreachable:NoExecute op=Exists for 300s

Events:
  Type    Reason     Age    From               Message
  ----    ------     ----   ----               -------
  Normal  Scheduled  4m49s  default-scheduler  Successfully assigned airflow/tutorial-test-20250410-print-date-l0izbrdk to node2
  Normal  Pulled     4m49s  kubelet            Container image "registry.k8s.io/git-sync/git-sync:v4.3.0" already present on machine
  Normal  Created    4m49s  kubelet            Created container: git-sync-init
  Normal  Started    4m49s  kubelet            Started container git-sync-init


ubuntu@node1:~$ kubectl logs tutorial-test-20250410-print-date-l0izbrdk -n airflow -c git-sync-init
INFO: detected pid 1, running init handler
{"logger":"","ts":"2025-06-04 02:14:00.718270","caller":{"file":"main.go","line":424},"level":0,"msg":"setting --ref from deprecated --branch"}
{"logger":"","ts":"2025-06-04 02:14:00.718756","caller":{"file":"main.go","line":456},"level":0,"msg":"setting --link from deprecated --dest"}
{"logger":"","ts":"2025-06-04 02:14:00.718765","caller":{"file":"main.go","line":506},"level":0,"msg":"setting --max-failures from deprecated --max-sync-failures"}
{"logger":"","ts":"2025-06-04 02:14:00.718819","caller":{"file":"main.go","line":626},"level":0,"msg":"starting up","version":"v4.3.0","pid":11,"uid":65533,"gid":65533,"home":"/tmp","flags":[]}
{"logger":"","ts":"2025-06-04 02:14:00.727522","caller":{"file":"main.go","line":731},"level":0,"msg":"git version","version":"git version 2.39.5"}
{"logger":"","ts":"2025-06-04 02:14:00.746527","caller":{"file":"main.go","line":1237},"level":0,"msg":"repo directory was empty or failed checks","path":"/git"}
{"logger":"","ts":"2025-06-04 02:14:00.746596","caller":{"file":"main.go","line":1247},"level":0,"msg":"initializing repo directory","path":"/git"}
{"logger":"","ts":"2025-06-04 02:16:16.076142","caller":{"file":"main.go","line":927},"msg":"error syncing repo, will retry","error":"Run(git fetch https://github.com/panhuida/airflow-dags-demo.git main --verbose --no-progress --prune --no-auto-gc --depth 1): context deadline exceeded: { stdout: \"\", stderr: \"fatal: unable to access 'https://github.com/panhuida/airflow-dags-demo.git/': Failed to connect to github.com port 443 after 135285 ms: Couldn't connect to server\" }","failCount":1}

```

**解决方案**

为 git-sync 配置代理 和 配置拉取github代码的重试次数，并，详见操作步骤中的内容。



#### 2. Airflow 界面上查看 Connections 出现 "Ooops!"  20250418

```shell
ubuntu@node1:~$ kubectl logs -f airflow-webserver-77fcdd8b44-pq4h5 -n airflow -c webserver
[2025-04-18T07:03:19.501+0000] {app.py:1744} ERROR - Exception on /connection/list/ [GET]
Traceback (most recent call last):
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 2529, in wsgi_app
    response = self.full_dispatch_request()
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1825, in full_dispatch_request
    rv = self.handle_user_exception(e)
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1823, in full_dispatch_request
    rv = self.dispatch_request()
         ^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1799, in dispatch_request
    return self.ensure_sync(self.view_functions[rule.endpoint])(**view_args)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask_appbuilder/security/decorators.py", line 151, in wraps
    return f(self, *args, **kwargs)                                                                                        
           ^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask_appbuilder/views.py", line 550, in list
    widgets = self._list()
              ^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask_appbuilder/baseviews.py", line 1179, in _list
    widgets = self._get_list_widget(
              ^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask_appbuilder/baseviews.py", line 1078, in _get_list_widget
    count, lst = self.datamodel.query(
                 ^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask_appbuilder/models/sqla/interface.py", line 499, in query
    query_results = query.all()
                    ^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/orm/query.py", line 2773, in all
    return self._iter().all()
           ^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/engine/result.py", line 1476, in all
    return self._allrows()
           ^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/engine/result.py", line 401, in _allrows
    rows = self._fetchall_impl()
           ^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/engine/result.py", line 1389, in _fetchall_impl
    return self._real_result._fetchall_impl()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/engine/result.py", line 1813, in _fetchall_impl
    return list(self.iterator)
           ^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/orm/loading.py", line 151, in chunks
    rows = [proc(row) for row in fetch]
            ^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/orm/loading.py", line 984, in _instance
    state.manager.dispatch.load(state, context)
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/event/attr.py", line 346, in __call__
    fn(*args, **kw)
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/orm/mapper.py", line 3702, in _event_on_load
    instrumenting_mapper._reconstructor(state.obj())
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/models/connection.py", line 215, in on_db_load
    if self.password:
       ^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/sqlalchemy/orm/attributes.py", line 606, in __get__
    retval = self.descriptor.__get__(instance, owner)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/models/connection.py", line 343, in get_password
    return fernet.decrypt(bytes(self._password, "utf-8")).decode()
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/cryptography/fernet.py", line 205, in decrypt
    raise InvalidToken
cryptography.fernet.InvalidToken
127.0.0.1 - - [18/Apr/2025:07:03:19 +0000] "GET /connection/list/ HTTP/1.1" 500 1588 "http://10.227.94.45:8890/dags/tutorial_test_20250410/grid?tab=graph&dag_run_id=manual__2025-04-18T06%3A26%3A36.378170%2B00%3A00&task_id=kubernetes_task" "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
```

解决方案

```shell
# 查看日志
ubuntu@node1:~$ kubectl logs -f airflow-webserver-6bcbf76b9-lh57x -n airflow

# 重新生成连接并加密
# 删除旧的连接
psql -h localhost -U airflow_k8s -d airflow_k8s
SELECT id, conn_id, password FROM connection;
delete from connection where conn_id = 'minio_default';

# 用 Web UI 或命令行重新添加连接
minio_default
Amazon Web Services
Access Key: QNbVk0LrGCOUNviswayw
Secret Key: nLmDKpMnCunZn9UAqf1nSDL279GfA5DaPKduR8st
{
  "region name": "us-east-1",
  "endpoint_url": "http://192.168.31.72:9000",
  "verify": false
}

# 在重新安装时，配置 fernet_key
# 本地测试，可能多次重新安装，将 fernet_key 配置到 value.yaml 中，避免 Airflow 配置的连接出现问题
ubuntu@node1:~$ echo Fernet Key: $(kubectl get secret --namespace airflow airflow-fernet-key -o jsonpath="{.data.fernet-key}" | base64 --decode)
Fernet Key: dEhHTzUybEFNOW1qNnhSZ1RyV3VNSW9UeXU0WElQUXg=
ubuntu@node1:~$ vim values-airflow.yaml
config:
  core:
    fernet_key: dEhHTzUybEFNOW1qNnhSZ1RyV3VNSW9UeXU0WElQUXg=
```



#### 3. 在 Airflow 界面查看任务执行日志时出现异常

```shell
ubuntu@node1:~$ kubectl logs -f airflow-webserver-6bcbf76b9-ww8sf -n airflow
[2025-06-04T03:36:13.600+0000] {app.py:1744} ERROR - Exception on /api/v1/dags/tutorial_test_20250410/dagRuns/manual__2025-06-04T03:34:57.738214+00:00/taskInstances/sleep/logs/1 [GET]
Traceback (most recent call last):
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 2529, in wsgi_app
    response = self.full_dispatch_request()
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1825, in full_dispatch_request
    rv = self.handle_user_exception(e)
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1823, in full_dispatch_request
    rv = self.dispatch_request()
         ^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/flask/app.py", line 1799, in dispatch_request
    return self.ensure_sync(self.view_functions[rule.endpoint])(**view_args)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/decorators/decorator.py", line 68, in wrapper
    response = function(request)
               ^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/decorators/uri_parsing.py", line 149, in wrapper
    response = function(request)
               ^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/decorators/validation.py", line 399, in wrapper
    return function(request)
           ^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/decorators/response.py", line 113, in wrapper
    return _wrapper(request, response)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/decorators/response.py", line 90, in _wrapper
    self.operation.api.get_connexion_response(response, self.mimetype)
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/apis/abstract.py", line 366, in get_connexion_response
    return cls._framework_to_connexion_response(response=response, mimetype=mimetype)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/connexion/apis/flask_api.py", line 165, in _framework_to_connexion_response
    body=response.get_data() if not response.direct_passthrough else None,
         ^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/werkzeug/wrappers/response.py", line 314, in get_data
    self._ensure_sequence()
  File "/home/airflow/.local/lib/python3.12/site-packages/werkzeug/wrappers/response.py", line 376, in _ensure_sequence
    self.make_sequence()
  File "/home/airflow/.local/lib/python3.12/site-packages/werkzeug/wrappers/response.py", line 391, in make_sequence
    self.response = list(self.iter_encoded())
                    ^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/werkzeug/wrappers/response.py", line 50, in _iter_encoded
    for item in iterable:
                ^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/utils/log/log_reader.py", line 87, in read_log_stream
    logs, metadata = self.read_log_chunks(ti, current_try_number, metadata)
                     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/utils/log/log_reader.py", line 64, in read_log_chunks
    logs, metadatas = self.log_handler.read(ti, try_number, metadata=metadata)
                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/utils/log/file_task_handler.py", line 514, in read
    log, out_metadata = self._read(task_instance, try_number_element, metadata)
                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/utils/log/file_task_handler.py", line 403, in _read
    remote_messages, remote_logs = self._read_remote_logs(ti, try_number, metadata)
                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/providers/amazon/aws/log/s3_task_handler.py", line 116, in _read_remote_logs
    keys = self.hook.list_keys(bucket_name=bucket, prefix=prefix)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/providers/amazon/aws/hooks/s3.py", line 126, in wrapper
    return func(*bound_args.args, **bound_args.kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/airflow/providers/amazon/aws/hooks/s3.py", line 880, in list_keys
    for page in response:
                ^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/botocore/paginate.py", line 269, in __iter__
    response = self._make_request(current_kwargs)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/botocore/paginate.py", line 357, in _make_request
    return self._method(**current_kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/botocore/client.py", line 569, in _api_call
    return self._make_api_call(operation_name, kwargs)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "/home/airflow/.local/lib/python3.12/site-packages/botocore/client.py", line 1023, in _make_api_call
    raise error_class(parsed_response, operation_name)
botocore.errorfactory.NoSuchBucket: An error occurred (NoSuchBucket) when calling the ListObjectsV2 operation: The specified bucket does not exist
```

**解决方案**

发现在 minio 创建的 Airflow 的存储桶为 airlfow，修改为 airflow







### 05 参考资料

#### 1. Airflow on Kubernetes: Running on and using k8s

https://www.youtube.com/watch?v=H8JjhiVGOlg

https://airflowsummit.org/slides/2022/i4-K8s-Jed.pdf



#### 2. Shared volumes in Airflow — the good, the bad and the ugly  20220725

https://medium.com/apache-airflow/shared-volumes-in-airflow-the-good-the-bad-and-the-ugly-22e9f681afca

![image-20250416180933963](2025-05-17-在 Kubernetes 集群上使用 Helm 部署 Airflow.assets/image-20250416180933963.png)https://gemini. https://gemini.google.com/app/0ba83d8954e61204

| **部署策略** | **优点**                                                 | **缺点**                                                     | **推荐用例**       |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| `kubectl cp` | 简单，适用于快速验证和开发                               | 缺乏版本控制，难以管理更新，需要手动操作，Pod 重启可能丢失文件 | 快速测试，开发环境 |
| 共享存储卷   | 持久化存储，所有 Airflow 组件均可访问，易于管理更新      | 配置相对复杂，需要预先配置存储                               | 开发/小型生产环境  |
| Git 同步     | 版本控制，代码更改时自动部署，易于协作，符合 GitOps 原则 | 配置稍复杂，需要处理仓库访问权限                             | 生产环境           |

