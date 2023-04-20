import * as cdk from 'aws-cdk-lib';
import {Construct} from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from "@aws-cdk/aws-apigatewayv2-integrations-alpha";
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import {InstanceClass, InstanceSize, SubnetType} from 'aws-cdk-lib/aws-ec2'
import * as path from "path";
import {CfnOutput, Duration} from "aws-cdk-lib";

export class HackathonWordpressBrefStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const vpc = new ec2.Vpc(this, "MyVpc", {});
        const database = new rds.DatabaseInstance(this, "WPDatabase", {
            engine: rds.DatabaseInstanceEngine.mariaDb({version: rds.MariaDbEngineVersion.VER_10_3}),
            instanceType: ec2.InstanceType.of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MICRO),
            vpc,
            vpcSubnets: {
                subnetType: SubnetType.PUBLIC
            },
            databaseName: "wordpress",
        });

        const brefLayer = lambda.LayerVersion.fromLayerVersionArn(this, "bref-fpm-layer", "arn:aws:lambda:us-east-1:534081306603:layer:php-82-fpm:33")
        const lambdaFunction = new lambda.Function(this, 'Function', {
            runtime: lambda.Runtime.PROVIDED_AL2,
            handler: "web/index.php",
            code: lambda.Code.fromAsset(path.join(__dirname, "..", "function-code")),
            layers: [brefLayer],
            timeout: Duration.seconds(28),
            environment: {
                DB_HOST: `${database.secret!.secretValueFromJson("host").unsafeUnwrap().toString()}:${database.secret!.secretValueFromJson("port").unsafeUnwrap().toString()}`,
                DB_USER: database
                    .secret!.secretValueFromJson("username")
                    .unsafeUnwrap()
                    .toString(),
                DB_PASSWORD: database
                    .secret!.secretValueFromJson("password")
                    .unsafeUnwrap()
                    .toString(),
                DB_NAME: database.secret!.secretValueFromJson("dbname").unsafeUnwrap().toString(),
                WP_ENV: "development",

            }
        });

        const wpIntegration = new HttpLambdaIntegration('wpIntegration', lambdaFunction);
        const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
            createDefaultStage: true,
            defaultIntegration: wpIntegration
        });
        lambdaFunction.addEnvironment("WP_HOME", httpApi.url!)
        lambdaFunction.addEnvironment("WP_SITEURL", httpApi.url!)


        new CfnOutput(this, 'WordpressUrl', {
          // The .url attributes will return the unique Function URL
          value: httpApi.url!,
        });
    }
}
