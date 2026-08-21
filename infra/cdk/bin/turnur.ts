#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';

import { TurnurPlaceholderStack } from '../lib/turnur-placeholder-stack';

const app = new cdk.App();

new TurnurPlaceholderStack(app, 'TurnurPlaceholderStack');
