@echo off

set "INSTANCE_ID=%~1"
if "%INSTANCE_ID%"=="" (
    set /p "INSTANCE_ID=Please enter InstanceId: "
)

start https://localhost

aws ssm start-session ^
    --target "%INSTANCE_ID%" ^
    --document-name AWS-StartPortForwardingSession ^
    --parameters "{\"portNumber\":[\"443\"],\"localPortNumber\":[\"443\"]}"