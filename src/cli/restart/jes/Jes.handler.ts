/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

import {
    ConnectionPropsForSessCfg,
    ICommandHandler,
    IHandlerParameters,
    ISession,
    ITaskWithStatus,
    Session,
    TaskProgress,
    TaskStage,
} from "@zowe/imperative";
import { ZosmfSession } from "@zowe/cli";
import { RestartJobs } from "../../../api/RestartJobs";
import { IRestartParms } from "../../../api/doc/input/IRestartParms";

/**
 * "zos-restart-jobs restart jes" command handler. Restart a job with Job ID starting from a specified step name.
 *
 * @export
 * @class JesHandler
 * @implements {ICommandHandler}
 */
export default class JesHandler implements ICommandHandler {
    /**
     * Command handler process - invoked by the command processor to handle the "zos-restart-jobs restart jes"
     *
     * @param {IHandlerParameters} commandParameters - command handler parameters
     * @returns {Promise<void>} - fulfilled when the command completes successfully OR rejected with imperative error
     * @memberof JesHandler
     */
    public async process(commandParameters: IHandlerParameters): Promise<void> {
        // Force yargs `jobid` and `stepname` parameters to be a string
        const jobid: string = commandParameters.arguments.jobid + "";
        const stepname: string = commandParameters.arguments.stepname + "";

        // Create session from arguments
        const sessCfg = ZosmfSession.createSessCfgFromArgs(
            commandParameters.arguments
        );
        const sessCfgWithCreds =
            await ConnectionPropsForSessCfg.addPropsOrPrompt<ISession>(
                sessCfg,
                commandParameters.arguments
            );
        const session = new Session(sessCfgWithCreds);

        const status: ITaskWithStatus = {
            statusMessage: "Restarting job",
            percentComplete: TaskProgress.TEN_PERCENT,
            stageName: TaskStage.IN_PROGRESS,
        };

        // Save the needed parameters for convenience
        const parms: IRestartParms = {
            viewAllSpoolContent:
                commandParameters.arguments.viewAllSpoolContent,
            directory: commandParameters.arguments.directory,
            extension: commandParameters.arguments.extension,
            waitForActive: commandParameters.arguments.waitForActive,
            waitForOutput: commandParameters.arguments.waitForOutput,
            task: status,
        };

        commandParameters.response.progress.startBar({ task: status });

        let apiObj: any; // API Object to set in the command JSON response
        let spoolFilesResponse: any; // Response from view all spool content option
        let directory: string = commandParameters.arguments.directory; // Path where to download spool content

        // API Object to set in the command JSON response
        /* eslint-disable prefer-const */
        apiObj = await RestartJobs.restartFailedJobWithParms(
            session,
            jobid,
            stepname,
            parms
        );
        if (parms.viewAllSpoolContent) {
            spoolFilesResponse = apiObj;
        }

        // Print the response to the command
        if (!spoolFilesResponse) {
            commandParameters.response.format.output({
                fields: ["jobid", "retcode", "jobname", "status"],
                output: apiObj,
                format: "object",
            });
            // Set the API object to the correct
            commandParameters.response.data.setObj(apiObj);

            // Print data from spool content
        } else {
            for (const spoolFile of spoolFilesResponse) {
                if (spoolFile.procName && spoolFile.procName.length > 0) {
                    commandParameters.response.console.log(
                        "Spool file: %s (ID #%d, Step: %s, ProcStep: %s)",
                        spoolFile.ddName,
                        spoolFile.id,
                        spoolFile.stepName,
                        spoolFile.procName
                    );
                } else {
                    commandParameters.response.console.log(
                        "Spool file: %s (ID #%d, Step: %s)",
                        spoolFile.ddName,
                        spoolFile.id,
                        spoolFile.stepName
                    );
                }
                commandParameters.response.console.log(spoolFile.data);
            }

            // Set the API object to the correct
            commandParameters.response.data.setObj(spoolFilesResponse);
        }

        // Print path where spool content was downloaded
        if (directory && !spoolFilesResponse) {
            directory = directory.includes("./") ? directory : `./${directory}`;
            commandParameters.response.console.log(
                `Successfully downloaded output to ${directory}/${apiObj.jobid}`
            );
        }
        commandParameters.response.progress.endBar();
        commandParameters.response.data.setMessage(
            `Restarted JCL with jobid "${jobid}" starting from step "${stepname}"`
        );
    }
}
