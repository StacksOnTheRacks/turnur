#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { TurnurApiStack } from '../lib/turnur-api-stack';

const app = new cdk.App();

new TurnurApiStack(app, 'TurnurApiStack');
