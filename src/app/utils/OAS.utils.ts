import { ApiEndp, ApiExample, ApiExampleRef, ApiFolder, ApiModel, ApiProject, ApiResponse, ApiTag, ApiTrait, SecurityDef } from '../models/ApiProject.model';
import { OpenAPIV2, OpenAPIV3_1, OpenAPI } from 'openapi-types';
import { Utils } from '../services/utils.service';
import { ExportOption } from '../services/importExport.service';
import { METHOD_WITH_BODY } from './constants';
import { JsonSchemaService } from '../components/common/json-schema-builder/jsonschema.service';
import { Env } from '../models/Envs.model';
import apic from './apic';

type OasTypes = 'OAS2' | 'OAS3';
type SchemaType<T> =
    T extends "OAS3" ? { [key: string]: OpenAPIV3_1.SchemaObject } :
    T extends "OAS2" ? { [key: string]: OpenAPIV2.SchemaObject } :
    never;
type ExampleType<T> =
    T extends "OAS3" ? { [key: string]: OpenAPIV3_1.ExampleObject } :
    T extends "OAS2" ? { [key: string]: OpenAPIV2.ExampleObject } :
    never;
type ResponseType<T> =
    T extends "OAS3" ? { [key: string]: OpenAPIV3_1.ResponseObject } :
    T extends "OAS2" ? { [key: string]: OpenAPIV2.ResponseObject } :
    never;
type ParamType<T> =
    T extends "OAS3" ? { [key: string]: OpenAPIV3_1.ParameterObject } :
    T extends "OAS2" ? { [key: string]: OpenAPIV2.ParameterObject } :
    never;
type PathType<T> =
    T extends "OAS3" ? { [key: string]: OpenAPIV3_1.PathItemObject } :
    T extends "OAS2" ? { [key: string]: OpenAPIV2.PathItemObject } :
    never;
type PathXType<T extends {} = {}> = {
    // $ref?: string,
    parameters?: (OpenAPIV2.Parameters | (OpenAPIV2.ReferenceObject | OpenAPIV2.ParameterObject)[])
} & {
        [method in (OpenAPIV2.HttpMethods | OpenAPIV3_1.HttpMethods)]?: (OpenAPIV3_1.OperationObject<T> | OpenAPIV2.OperationObject<T>)
    };

export class OASUtils {
    static getInfo(proj: ApiProject): OpenAPIV3_1.InfoObject {
        let info: OpenAPIV3_1.InfoObject = {
            title: proj.title,
            description: proj.description,
            version: proj.version,
            termsOfService: proj.termsOfService
        };

        if (proj.contact) {
            info.contact = {
                ... (proj.contact.name && { name: proj.contact.name }),
                ... (proj.contact.url && { url: proj.contact.url }),
                ... (proj.contact.email && { email: proj.contact.email })
            };
        }

        if (proj.license?.name) {
            info.license = {
                ...(proj.license.name && { name: proj.license.name }),
                ... (proj.license.url && { url: proj.license.url })
            };
        }

        return info;
    }

    static getServers(proj: ApiProject, env: Env): OpenAPIV3_1.ServerObject[] {
        if (!proj.setting.protocol) proj.setting.protocol = '';
        let variables = {};
        env?.vals.forEach(kv => {
            if (!kv.readOnly) {
                variables[kv.key] = { default: kv.val }
            }
        })
        return (Array.isArray(proj.setting.protocol) ? proj.setting.protocol : [proj.setting.protocol]).map(scheme => {
            let basePath = (proj.setting.basePath || '').replace(/\/$/, '') // Trailing slashes generally shouldn't be included
            let server = {
                url: (scheme ? scheme + ':' : '') + '//' + (proj.setting.host || '') + basePath,
                variables
            }
            return server;
        });
    }

    static getTags(proj: ApiProject): OpenAPIV3_1.TagObject[] {
        if (proj.tags?.length > 0) {
            return proj.tags.map(tag => {
                let specTag: any = {
                    name: tag.name,
                    description: tag.description
                };
                if (tag.externalDocs?.url) {
                    specTag.externalDocs = tag.externalDocs
                }
                if (tag.xProperty?.length > 0) {
                    tag.xProperty.forEach(kv => {
                        if (kv.key) {
                            specTag[kv.key] = kv.val
                        }
                    });
                }
                return specTag;
            })
        } else {
            return [];
        }
    }

    static getSecuritySchemes(proj: ApiProject, type: OasTypes) {
        var secDefs = {};
        proj.securityDefinitions?.forEach(function (def) {
            var defObj: any = {
                type: def.type,
                description: def.description || ''
            }

            //process x-properties
            def.xProperty?.forEach((prop) => {
                if (prop.key?.startsWith('x-')) {
                    defObj[prop.key] = prop.val
                }
            });

            if (type === 'OAS3') {
                switch (def.type) {
                    case 'basic':
                        defObj.type = 'http';
                        defObj.scheme = 'basic';
                        break;
                    case 'bearer':
                        defObj.type = 'http';
                        defObj.scheme = 'bearer';
                        if (def.bearer?.bearerFormat) defObj.bearerFormat = def.bearer.bearerFormat;
                        break;
                    case 'apiKey':
                        defObj.in = def.apiKey.in;
                        defObj.name = def.apiKey.name;
                        break;
                    case 'oauth2':
                        let flow: any = {};
                        let flowName = def.oauth2.flow;
                        if (def.oauth2.flow == 'application') {
                            flowName = 'clientCredentials';
                        }
                        if (def.oauth2.flow == 'accessCode') {
                            flowName = 'authorizationCode';
                        }
                        if (typeof def.oauth2.authorizationUrl !== 'undefined' && def.oauth2.authorizationUrl) {
                            flow.authorizationUrl = def.oauth2.authorizationUrl;
                        }
                        if (def.oauth2.tokenUrl) {
                            flow.tokenUrl = def.oauth2.tokenUrl;
                        }
                        flow.scopes = {};
                        if (def.oauth2.scopes.length > 0) {
                            def.oauth2.scopes.forEach((s) => {
                                flow.scopes[s.key] = s.val;
                            });
                        }
                        defObj.flows = {
                            [flowName]: flow
                        }
                        break;
                }
            } else {
                switch (def.type) {
                    case 'apiKey':
                        defObj.in = def.apiKey.in;
                        defObj.name = def.apiKey.name;
                        break;
                    case 'bearer':
                        defObj.type = 'apiKey';
                        defObj.in = 'header';
                        break;
                    case 'oauth2':
                        defObj.flow = def.oauth2.flow;
                        if (def.oauth2.flow == 'implicit' || def.oauth2.flow == 'accessCode') {
                            defObj.authorizationUrl = def.oauth2.authorizationUrl;
                        }
                        if (['password', 'application', 'accessCode'].includes(def.oauth2.flow)) {
                            defObj.tokenUrl = def.oauth2.tokenUrl;
                        }
                        defObj.scopes = {};
                        if (def.oauth2.scopes.length > 0) {
                            def.oauth2.scopes.forEach(function (s) {
                                defObj.scopes[s.key] = s.val;
                            })
                        }
                        break;
                }
            }
            secDefs[def.name] = defObj;
        });
        return secDefs;
    }

    static getComponents(proj: ApiProject, options?: ExportOption): OpenAPIV3_1.ComponentsObject {
        let components: OpenAPIV3_1.ComponentsObject = {};

        if (proj.securityDefinitions && proj.securityDefinitions.length > 0) {
            components.securitySchemes = OASUtils.getSecuritySchemes(proj, 'OAS3')
        }

        components.schemas = OASUtils.getSchemaDefinitions(proj, options, 'OAS3')
        components.parameters = OASUtils.getParams(proj, 'OAS3')
        components.responses = OASUtils.getResponses(proj, 'OAS3');
        components.examples = OASUtils.getExamples(proj, options, 'OAS3');

        return components;
    }

    static getPaths<T extends OasTypes>(proj: ApiProject, type: T, options?: ExportOption): PathType<T> {
        let paths: { [key: string]: OpenAPIV3_1.PathItemObject | OpenAPIV2.PathItemObject } = {};
        //add paths
        for (const [id, endp] of Utils.objectEntries(proj.endpoints)) {
            if (paths[endp.path] === undefined) {
                paths[endp.path] = {};
            }
            let reqObj: OpenAPIV3_1.OperationObject = {
                tags: endp.tags,
                summary: endp.summary,
                description: endp.description,
                parameters: [],
                ...(endp.operationId && { operationId: endp.operationId }),
                ...(endp.deprecated && { deprecated: endp.deprecated }),
                ...(options?.includeApicIds && { 'x-apic-id': endp._id }),
                ...(endp.security && {
                    security: endp.security.map((sec) => {
                        var secObj = {};
                        secObj[sec.name] = [];
                        return secObj;
                    })
                }),
                ...(type === 'OAS2' && {
                    consumes: endp.consumes,
                    produces: endp.produces,
                    ...(endp.schemes && { schemes: endp.schemes.map(s => s.key) })
                })
            }

            //TODO: Map schemes to server URL
            // for (var i= 0; i<endp.schemes.length; i++) {
            // reqobj.schemes.push(endp.schemes[i].key);
            //}}

            reqObj.responses = {};
            let produces = endp.produces?.length > 0 ? endp.produces : ['*/*'];
            for (var j = 0; j < endp.responses.length; j++) {
                let code = endp.responses[j].code;
                let response: any = {
                    description: endp.responses[j].desc ? endp.responses[j].desc : '',
                };
                if (type === 'OAS3') {
                    for (let mimetype of produces) {
                        if (endp.responses[j].data?.$ref?.startsWith('#/responses/')) {
                            response = endp.responses[j].data;
                        } else {
                            response.content = {};
                            response.content[mimetype] = {};
                            response.content[mimetype].schema = endp.responses[j].data;
                            if (endp.responses[j].examples?.length > 0) {
                                response.content[mimetype].examples = endp.responses[j].examples?.reduce((obj, ex) => {
                                    const key = ex.key;
                                    return ({ ...obj, [key]: { $ref: `#/components/examples/${proj.examples[ex.val]?.name}` } })
                                }, {})
                            }
                            if (response.content[mimetype].schema.type == 'file') {
                                response.content[mimetype].schema = { type: 'string', format: 'binary' };
                            }
                        }
                    }
                } else {
                    if (endp.responses[j].data?.$ref?.startsWith('#/responses/')) {
                        response = endp.responses[j].data;
                    } else {
                        response.schema = endp.responses[j].data;
                    }
                }
                reqObj.responses[code] = response;
            }

            //add query parameters
            for (const [key, schema] of Utils.objectEntries(endp.queryParams.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'query',
                    // style: form',
                    // explode: true,
                    description: schema.description ? schema.description : "",
                    required: endp.queryParams.required && endp.queryParams.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                };
                reqObj.parameters.push(param);
            };

            //add headers
            for (const [key, schema] of Utils.objectEntries(endp.headers.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'header',
                    // style: simple',
                    description: schema.description ? schema.description : "",
                    required: endp.headers.required && endp.headers.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                };
                reqObj.parameters.push(param);
            };

            //add path params
            for (const [key, schema] of Utils.objectEntries(endp.pathParams.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'path',
                    // style: simple',
                    description: schema.description ? schema.description : '',
                    required: endp.pathParams.required && endp.pathParams.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                };
                reqObj.parameters.push(param);
            };

            if (METHOD_WITH_BODY.includes(endp.method.toUpperCase()) && endp.body) { //if the trait has body add body params
                if (type == 'OAS3') {
                    let reqBody: OpenAPIV3_1.RequestBodyObject;
                    switch (endp.body.type) {
                        case 'raw':
                            let consumes = endp.consumes || ['application/json'];
                            reqBody = {
                                content: {},
                                required: true
                                //description: schema.description ? schema.description : "",
                                //required: endp.body.data[x].required ? true: false
                            };
                            if (consumes?.length > 0) {
                                for (let mimetype of consumes) {
                                    reqBody.content[mimetype] = {};
                                    reqBody.content[mimetype].schema = endp.body.data;
                                }
                            } else {
                                reqBody.content['*/*'] = {
                                    schema: endp.body.data
                                }
                            }
                            break;
                        case 'form-data':
                        case 'x-www-form-urlencoded':
                            let contentType = endp.body.type === 'form-data' ? 'multipart/form-data' : 'application/x-www-form-urlencoded';
                            let schema: OpenAPIV3_1.SchemaObject = {
                                type: 'object',
                                properties: {},
                                required: []
                            }
                            endp.body.data.forEach(input => {
                                let item: OpenAPIV3_1.SchemaObject = {
                                    type: input.type,
                                    description: input.desc || '',
                                    ...(input.type == 'array' && { items: { type: 'string' } })
                                }

                                if (input.required) schema.required.push(input.key);
                                if ((input.type === 'file')) {
                                    item.type = 'string';
                                    item.format = 'binary';
                                }
                                schema.properties[input.key] = item;
                            });
                            if (schema.required.length === 0) delete schema.required;
                            reqBody = {
                                content: {
                                    [contentType]: { schema }
                                }
                            }
                            break;
                    }
                    reqObj.requestBody = reqBody
                } else {
                    switch (endp.body.type) {
                        case 'raw':
                            let param = {
                                name: 'body',
                                in: 'body',
                                schema: endp.body.data
                                //description: schema.description ? schema.description : '',
                                //required: endp.body.data[x].required ? true : false
                            };
                            reqObj.parameters.push(param);
                            break;
                        case 'form-data':
                        case 'x-www-form-urlencoded':
                            for (var x = 0; x < endp.body.data.length; x++) {
                                let param: any = {
                                    name: endp.body.data[x].key,
                                    in: 'formData',
                                    type: endp.body.data[x].type,
                                    description: endp.body.data[x].desc ? endp.body.data[x].desc : '',
                                    required: endp.body.data[x].required ? true : false
                                };
                                if (param.type === 'array') {
                                    param.items = {
                                        type: 'string'
                                    };
                                }
                                reqObj.parameters.push(param);
                            }
                            break;
                    }
                }
            }

            // importing details from traits
            for (var j = 0; j < endp.traits.length; j++) {
                var traitObj = proj.traits[endp.traits[j]._id];
                let tName = traitObj.name;
                //responses
                for (let i = 0; i < traitObj.responses.length; i++) {
                    // var xPath = 'trait.' + tName + '.' + traitObj.responses[i].code;
                    let xPath = traitObj.responses[i].code;
                    if (!traitObj.responses[i].noneStatus) {
                        let schema: OpenAPIV3_1.ReferenceObject = {
                            '$ref': (type === 'OAS3' ? '#/components/responses/' : '#/responses/') + xPath
                        };
                        reqObj.responses[traitObj.responses[i].code] = schema;
                    }
                }

                //path params
                if (traitObj.pathParams) {
                    for (const [key, schema] of Utils.objectEntries(traitObj.pathParams.properties)) {
                        var xPath = 'trait.' + tName + '.' + key;
                        reqObj.parameters.push({
                            '$ref': (type === 'OAS3' ? '#/components/parameters/' : '#/parameters/') + xPath

                        });
                    }
                }

                //query params
                for (const [key, schema] of Utils.objectEntries(traitObj.queryParams.properties)) {
                    var xPath = 'trait.' + tName + '.' + key;
                    reqObj.parameters.push({
                        '$ref': (type === 'OAS3' ? '#/components/parameters/' : '#/parameters/') + xPath

                    });
                }

                // header params
                for (const [key, schema] of Utils.objectEntries(traitObj.headers.properties)) {
                    var xPath = 'trait.' + tName + '.' + key;
                    reqObj.parameters.push({
                        '$ref': (type === 'OAS3' ? '#/components/parameters/' : '#/parameters/') + xPath
                    });
                }
            }
            paths[endp.path][endp.method] = reqObj;
        };
        return paths as PathType<T>;
    }

    static getSchemaDefinitions<T extends OasTypes>(proj: ApiProject, options: ExportOption, type: T): SchemaType<T> {
        let componentSchemas: { [key: string]: OpenAPIV3_1.SchemaObject | OpenAPIV2.SchemaObject } = {}

        //add definitions/models
        for (const [id, model] of Utils.objectEntries(proj.models)) {
            model.data = JsonSchemaService.sanitizeModel(model.data);
            componentSchemas[model.nameSpace] = model.data;
            if (options?.includeApicIds) {
                componentSchemas[model.nameSpace]['x-apic-id'] = model._id;
            }
        };
        return componentSchemas as SchemaType<T>;
    }

    static getExamples<T extends OasTypes>(proj: ApiProject, options: ExportOption, type: T): ExampleType<T> {
        let componentExamples: { [key: string]: OpenAPIV3_1.ExampleObject | OpenAPIV2.ExampleObject } = {}

        for (const [id, example] of Utils.objectEntries(proj.examples)) {
            let specEx = {
                summary: example.summary,
                description: example.description,
                ...(example.valueType === 'external' && { externalValue: example.value }),
                ...(example.valueType === 'inline' && { value: example.value }),
                ...(example.valueType === '$ref' && { $ref: `#/components/examples/${proj.examples[example.value].name}` })
            }
            componentExamples[example.name] = specEx;
            if (options?.includeApicIds) {
                componentExamples[example.name]['x-apic-id'] = example._id;
            }
        }
        return componentExamples as ExampleType<T>;
    }

    static getResponses<T extends OasTypes>(proj: ApiProject, type: T): ResponseType<T> {
        let componentResponses: { [key: string]: OpenAPIV3_1.ResponseObject | OpenAPIV2.ResponseObject } = {};

        ////responses and parameters are added from traits
        for (const [id, trait] of Utils.objectEntries(proj.traits)) {
            var responses = trait.responses;
            let tName = trait.name.replace(/\s/g, ' ');

            for (var i = 0; i < responses.length; i++) {
                var schema = responses[i].data;
                // var name = 'trait.' + tName + '.' + responses[i].code;
                var name = responses[i].code;
                componentResponses[name] = {
                    description: responses[i].desc ? responses[i].desc : '',
                    ...(type === 'OAS3' ? {
                        content: {
                            '*/*': {
                                schema,
                                ...(responses[i].examples?.length > 0 && {
                                    examples: responses[i].examples?.reduce((obj, ex) => {
                                        const key = ex.key;
                                        return ({ ...obj, [key]: { $ref: `#/components/examples/${proj.examples[ex.val].name}` } })
                                    }, {})
                                })
                            }
                        }
                    } : { schema })
                };
            }
        }
        return componentResponses as ResponseType<T>;
    }

    static getParams<T extends OasTypes>(proj: ApiProject, type: T): ParamType<T> {
        let componentParameters: { [key: string]: OpenAPIV3_1.ParameterObject | OpenAPIV2.ParameterObject } = {};
        ////responses and parameters are added from traits,
        for (const [id, trait] of Utils.objectEntries(proj.traits)) {
            let tName = trait.name.replace(/\s/g, ' ');
            for (const [key, schema] of Utils.objectEntries(trait.pathParams?.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'path',
                    description: schema.description ? schema.description : '',
                    required: trait.pathParams.required && trait.pathParams.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                }
                let name = 'trait.' + tName + '.' + key;
                componentParameters[name] = param;
            }

            for (const [key, schema] of Utils.objectEntries(trait.queryParams?.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'query',
                    description: schema.description ? schema.description : "",
                    required: trait.queryParams.required && trait.queryParams.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                };
                var name = 'trait.' + tName + '.' + key;
                componentParameters[name] = param;
            }

            for (const [key, schema] of Utils.objectEntries(trait.headers?.properties as { [key: string]: any })) {
                let param = {
                    name: key,
                    in: 'header',
                    description: schema.description ? schema.description : "",
                    required: trait.headers.required && trait.headers.required.indexOf(key) >= 0 ? true : false,
                    ...(type === 'OAS3' ? { schema } : schema)
                };
                var name = 'trait.' + tName + '.' + key;
                componentParameters[name] = param; + key;
            };
        }
        return componentParameters as ParamType<T>;
    };

    static importOAS3(spec: OpenAPIV3_1.Document): ApiProject {
        if (spec.openapi) return;
        var proj: ApiProject = OASUtils.parseOasSpecBase(spec);

    }

    static parseOasSpecBase(spec: OpenAPIV3_1.Document | OpenAPIV2.Document) {
        var proj: ApiProject = {
            title: spec.info.title,
            description: spec.info.description || '',
            version: spec.info.version || '',
            termsOfService: spec.info.termsOfService || '',
            setting: {},
            folders: {},
            models: {},
            traits: {},
            endpoints: {}
        }
        if (spec.info.license) {
            proj.license = {
                name: spec.info.license.name || '',
                url: spec.info.license.url || ''
            }; '';
        }
        if (spec.info.contact) {
            proj.contact = {
                name: spec.info.contact.name ?? '',
                email: spec.info.contact.email ?? '',
                url: spec.info.contact.url ?? '',
            }
        }
        return proj;
    }

    static parseServers(spec: OpenAPIV3_1.Document | OpenAPIV2.Document): Env[] {
        if ('openapi' in spec) {
            return spec.servers?.map((server, i) => {
                let env: Env = {
                    name: spec.info.title + '-env' + (i > 0 && i),
                    vals: Utils.objectEntries(server.variables).map(([key, val]) => {
                        return { key, val: val.default }
                    }),
                }
                //populate host, basePath & scheme
                if (server.url) {
                    let urlObj: any = {};
                    try {
                        urlObj = new URL(server.url);
                    } catch {
                        let urlRegex = /^((http[s]?|ftp):\/\/)?([^:\/\s]+)(:([^\/]*))?((\/[\.\w]+)*\/?)(\?([^#]*))?(#(.*))?$/;
                        let groups = server.url.match(urlRegex);
                        urlObj.protocol = groups?.[1];
                        urlObj.host = groups?.[3] + groups?.[4];
                        urlObj.pathname = groups?.[6];
                    }
                    env.vals.push({ key: 'host', val: urlObj.host, readOnly: true });
                    env.vals.push({ key: 'basePath', val: urlObj.pathname, readOnly: true });
                    env.vals.push({ key: 'scheme', val: urlObj.protocol.slice(0, -1), readOnly: true });
                }
                return env;
            })
        } else if ('swagger' in spec) {
            return [{
                name: spec.info.title + '-env',
                vals: [{
                    key: 'basePath',
                    val: spec.basePath || ''
                }, {
                    key: 'host',
                    val: spec.host || ''
                }, {
                    key: 'scheme',
                    val: spec.schemes?.length > 0 ? spec.schemes[0] : 'http'
                }]
            }]
        }
    }

    static parseTags(spec: OpenAPIV3_1.Document | OpenAPIV2.Document): ApiTag[] {
        return (spec.tags || []).map(tag => {
            return {
                name: tag.name,
                description: tag.description,
                ...(tag.externalDocs && {
                    externalDocs: {
                        url: tag.externalDocs.url,
                        description: tag.externalDocs.description
                    }
                }),
                xProperty: Utils.objectEntries(tag as { [key: string]: any })
                    .filter(props => !['name', 'description', 'externalDocs'].includes(props[0]))
                    .map(([key, val]) => { return { key, val } })
            }
        })
    }

    static parseSecuritySchemes(spec: OpenAPIV3_1.Document | OpenAPIV2.Document): SecurityDef[] {
        if ('openapi' in spec) {
            return Utils.objectEntries(spec.components.securitySchemes).map(([name, security]) => {
                let secDef: SecurityDef = {
                    name,
                    type: 'basic',
                    description: ('description' in security) ? security.description : '',
                    xProperty: Utils.objectEntries(security as { [key: string]: any })
                        .filter(([key, val]) => key.startsWith('x-'))
                        .map(([key, val]) => {
                            return {
                                key,
                                val: typeof val === 'string' ? val : JSON.stringify(val)
                            }
                        })
                }
                if ('type' in security) {
                    switch (security.type) {
                        case 'http':
                            if (security.scheme === 'basic') {
                                secDef.type = 'basic';
                            } else if (security.scheme === 'bearer') {
                                secDef.type = 'bearer';
                                secDef.bearer = {
                                    bearerFormat: security.bearerFormat
                                }
                            }
                            break;
                        case 'apiKey':
                            secDef.type = 'apiKey';
                            secDef.apiKey = {
                                name: security.name,
                                in: security.in
                            }
                            break;
                        case 'oauth2':
                            secDef.type = 'oauth2';
                            let flowName = Object.keys(security.flows)[0], //TODO: Handle others
                                flow = security.flows[flowName];
                            let oauth2: any = {}
                            if (flowName === 'clientCredentials') {
                                oauth2.flow = 'application';
                            } else if (flowName === 'authorizationCode') {
                                oauth2.flow = 'accessCode';
                            } else {
                                oauth2.flow = flowName;
                            }
                            oauth2.authorizationUrl = flow.authorizationUrl ?? '';
                            oauth2.tokenUrl = flow.tokenUrl ?? '';
                            secDef.oauth2 = oauth2;
                            oauth2.scopes = Utils.objectEntries(flow.scopes).map(([key, val]) => { return { key, val } });
                            break;
                        default:
                            console.warn(`Security scheme ${security.type} not supported yet.`)
                    }
                }
                return secDef;
            })
        } else {
            return Utils.objectEntries(spec.securityDefinitions).map(([name, def]) => {
                var secdef: SecurityDef = {
                    name: name,
                    type: def.type,
                    description: def.description,
                    xProperty: []
                }

                //import x-properties
                Utils.objectKeys(def).forEach((key) => {
                    if (key.startsWith('x-')) {
                        secdef.xProperty.push({
                            key: key,
                            val: def[key]
                        })
                    }
                })
                switch (def.type) {
                    case 'apiKey':
                        secdef.apiKey = {
                            in: def.in,
                            name: def.name
                        }
                        break;
                    case 'oauth2':
                        secdef.oauth2 = {
                            flow: def.flow,
                            // authorizationUrl: def. authorizationUrl,
                            scopes: []
                        }
                        if (def.flow == 'implicit' || def.flow == 'accessCode') {
                            secdef.oauth2.authorizationUrl = def.authorizationUrl;
                        }
                        if (['password', 'application', 'accessCode'].includes(def.flow)) {
                            secdef.oauth2.tokenUrl = (def as (OpenAPIV2.SecuritySchemeOauth2AccessCode | OpenAPIV2.SecuritySchemeOauth2Password | OpenAPIV2.SecuritySchemeOauth2Application)).tokenUrl;
                        }
                        for (const [scope, desc] of Utils.objectEntries(def.scopes)) {
                            secdef.oauth2.scopes.push({ key: scope, val: desc });
                        }
                        if (secdef.oauth2.scopes.length == 0) {
                            secdef.oauth2.scopes.push({ key: '', val: '' });
                        }
                        break;
                }
                return secdef;
            })
        }
    }


    static parseSchemaDefinitions(spec: OpenAPIV3_1.Document | OpenAPIV2.Document): { folders: { [key: string]: ApiFolder }, models: { [key: string]: ApiModel } } {
        let modelFolder = {
            _id: apic.s12(),
            name: 'Models',
            desc: 'This folder will contain all the models.'
        };
        let models = {}

        let definitions = 'openapi' in spec ? spec.components.schemas : spec.definitions;
        for (const [name, model] of Utils.objectEntries(definitions as { [key: string]: any })) {
            var id = apic.s12(), newModel: any = {};
            newModel._id = id; newModel.name = name;
            newModel.nameSpace = name;

            //add type if missing
            // if (!model.type) {
            //     if (model.properties) model.type = 'object';
            //     else if ('items' in model) model.type = 'array';
            //     // else if ($ref' in model) delete model.type; //TODO: check if required
            //     else model.type = 'string';
            // }
            newModel.data = JsonSchemaService.sanitizeModel(model);
            newModel.folder = modelFolder._id;
            models[newModel._id] = newModel;
        }
        return {
            folders: {
                [modelFolder._id]: modelFolder
            },
            models
        };
    }

    static parseExamples(spec: OpenAPIV3_1.Document): { folders: { [key: string]: ApiFolder }, examples: { [key: string]: ApiExample } } {
        let folder: ApiFolder = {
            _id: apic.s12(),
            name: 'Examples',
            desc: 'This folder will contain all the example objects.'
        }
        let examples: { [key: string]: ApiExample } = {}
        let examplesMap = spec.components.examples;
        for (const [name, example] of Utils.objectEntries(examplesMap)) {
            let _id = apic.s12();
            let newExample: ApiExample = {
                _id,
                name,
                folder: folder._id
            };
            newExample.summary = example.summary;
            newExample.description = example.description;
            if ('$ref' in example) {
                newExample.valueType = '$ref';
                newExample.value = example.$ref
            } else {
                if (example.value) {
                    newExample.value = example.value;
                    newExample.valueType = 'inline'
                } else if (example.externalValue) {
                    newExample.value = example.externalValue;
                    newExample.valueType = 'external'
                }
            }
            examples[newExample._id] = newExample;
        }
        //once all examples are parsed, update the $refs with the _id of corresponding $ref value
        for (const [_id, example] of Utils.objectEntries(examples)) {
            if (example.valueType === '$ref') {
                let refName = example.value.substring(example.value.lastIndexOf('/') + 1);
                let resolvedRef: ApiExample = Utils.objectValues(examples).find(ex => ex.name === refName);
                example.value = resolvedRef?._id;
                //$refs wont have any sibling values like summary and description so copy it from resolved ref
                example.summary = resolvedRef.summary ?? example.summary
                example.description = resolvedRef.description ?? example.description
            }
        }
        return {
            folders: {
                [folder._id]: folder
            },
            examples
        }
    }

    static parseParameters(spec: OpenAPIV3_1.Document | OpenAPIV2.Document, proj: ApiProject): { [key: string]: ApiTrait } {
        let parameters = 'openapi' in spec ? spec.components.parameters : spec.parameters;
        let traits: ApiTrait[] = Utils.objectValues(proj.traits);
        //TODO: Add support for body params available in OAS3 in traits
        if (parameters) {
            for (const [name, param] of Utils.objectEntries(parameters as { [key: string]: any })) {
                let traitName = '';
                if (name.indexOf('trait') === 0 && (name.match(/\./g) || []).length === 2) {
                    traitName = name.split('.')[1];
                } else {
                    traitName = name;
                }
                //check if trait is already there
                var tmpTrait = traits.find(t => t.name === traitName);

                //if trait is not there create one
                if (!tmpTrait) {
                    tmpTrait = {
                        _id: apic.s12(),
                        name: traitName,
                        queryParams: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        folder: '',
                        headers: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        pathParams: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        responses: []
                    };
                }

                let parsedParams = OASUtils.parsePathParams([param], proj);
                ['queryParams', 'pathParams', 'headers'].forEach(pType => {
                    tmpTrait[pType] = {
                        properties: { ...tmpTrait[pType].properties, ...parsedParams[pType].properties },
                        type: ['object'],
                        required: [...tmpTrait[pType].required, ...parsedParams[pType].required]
                    }
                })
                traits.push(tmpTrait);
            }
        }

        return traits.reduce((obj, trait) => {
            const key = trait._id;
            return ({ ...obj, [key]: trait })
        }, {});
    }

    static parseResponses(spec: OpenAPIV3_1.Document | OpenAPIV2.Document, proj: ApiProject): { traits: { [key: string]: ApiTrait }, examples: { [key: string]: ApiExample } } {
        let responses = 'openapi' in spec ? spec.components.responses : spec.responses;
        let traits: ApiTrait[] = Utils.objectValues(proj.traits);
        let examples: ApiExample[] = [];
        if (responses) {
            for (const [name, resp] of Utils.objectEntries(responses as { [key: string]: any })) {
                let traitName = '', code = name, noneStatus = false;
                if (name.indexOf('trait') === 0 && name.indexOf('.') > 0) {
                    traitName = name.split('.')[1];
                    code = name.split('.')[2];
                    if (!/^\d+$/.test(code)) {
                        noneStatus = true;
                    }
                } else {
                    traitName = name;
                    noneStatus = true;
                }

                //check if trait is already there
                var tmpTrait = traits.find(t => t.name === traitName);
                //if trait is not there create one
                if (!tmpTrait) {
                    tmpTrait = {
                        _id: apic.s12(),
                        name: traitName,
                        queryParams: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        folder: '',
                        headers: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        pathParams: {
                            type: ["object"],
                            properties: {},
                            required: []
                        },
                        responses: []
                    };
                    traits.push(tmpTrait);
                }

                //resp ->description, schema
                if ('openapi' in spec) {
                    Utils.objectEntries(resp.content as { content?: { [media: string]: OpenAPIV3_1.MediaTypeObject } })
                        .forEach(([mime, schemaData], index) => {
                            let tmpResp: ApiResponse = {
                                code: code + (index > 0 ? ('-' + mime) : ''),
                                data: schemaData.schema,
                                examples: [],
                                desc: resp.description,
                                noneStatus
                            };
                            //parse examples
                            let parsedExamples = OASUtils.parseResponseExamples(schemaData, proj, traitName);
                            tmpResp.examples = parsedExamples.exampleRefs;
                            examples = [...examples, ...parsedExamples.examples];
                            tmpTrait.responses.push(tmpResp);
                        })
                } else {
                    let tmpResp: ApiResponse = {
                        code: code,
                        data: resp.schema,
                        examples: [],
                        desc: resp.description,
                        noneStatus: noneStatus
                    };
                    tmpTrait.responses.push(tmpResp);
                }
            };
        }
        return {
            traits: traits.reduce((obj, trait) => {
                const key = trait._id
                return ({ ...obj, [key]: trait })
            }, {}),
            examples: examples.reduce((obj, ex) => {
                const key = ex._id
                return ({ ...obj, [key]: ex })
            }, {})
        }
    }

    static parsePaths(spec: OpenAPIV3_1.Document | OpenAPIV2.Document, optn, proj: ApiProject): { folders: { [key: string]: ApiFolder }, endpoints: { [key: string]: ApiEndp }, examples: { [key: string]: ApiExample } } {
        let paths = spec.paths;
        let endpoints: ApiEndp[] = [];
        let folders: ApiFolder[] = [];
        let examples: ApiExample[] = [];

        //parsing endpoints
        if (paths) {
            for (const [pathName, apis] of Utils.objectEntries(paths as PathXType)) {
                var fname = '';
                if (optn.groupby === 'path') {
                    fname = pathName.substring(1, pathName.length);
                    fname = fname.substring(0, fname.indexOf('/') > 0 ? fname.indexOf('/') : fname.length);
                }
                var folderId;
                if (fname) {
                    let existingFolder = folders.find(f => f.name === fname);
                    if (!existingFolder) {
                        let pathFolder = {
                            _id: apic.s12(),
                            name: fname,
                            desc: `This folder contains the requests for endpoint ${pathName}`
                        };
                        folders.push(pathFolder);
                        folderId = pathFolder._id;
                    } else {
                        folderId = existingFolder._id;
                    }
                }
                //parse common params at path level that are applicable for al the operations under this path
                let commonParams = OASUtils.parsePathParams(('parameters' in apis) ? apis.parameters : [], proj)

                for (const [method, path] of Utils.objectEntries(apis as { [key: string]: (OpenAPIV3_1.OperationObject | OpenAPIV2.OperationObject) })) {
                    if (optn.groupby === 'tag') {
                        let fname = '';
                        if (path.tags && path.tags[0]) {
                            fname = path.tags[0];
                        }
                        let existingFolder = folders.find(f => f.name === fname);
                        if (!existingFolder && fname) {
                            let pathFolder = {
                                _id: apic.s12(),
                                name: fname,
                                desc: `This folder contains the requests for endpoint ${pathName}`
                            }
                            folders.push(pathFolder);
                            folderId = pathFolder._id;
                        } else if (existingFolder) {
                            folderId = existingFolder._id;
                        }
                    }
                    if (['get', 'post', 'put', 'delete', 'options', 'head', 'patch', 'trace'].indexOf(method) >= 0) {
                        var tmpEndP: ApiEndp = {
                            _id: apic.s12(),
                            path: pathName,
                            method,
                            summary: path.summary || '',
                            headers: Utils.clone(commonParams.headers),
                            queryParams: Utils.clone(commonParams.queryParams),
                            pathParams: Utils.clone(commonParams.pathParams),
                            body: Utils.clone(commonParams.body),
                            prerun: '',
                            postrun: '',
                            traits: Utils.clone(commonParams.traits),
                            responses: [],
                            folder: folderId,
                            tags: path.tags || [],
                            description: path.description || '',
                            operationId: path.operationId || '',
                            deprecated: !!path.deprecated,
                            schemes: []
                        }
                        let produces = new Set<string>(), consumes = new Set<string>();
                        if ('produces' in path) {
                            path.produces.forEach(produces.add.bind(produces))
                        }
                        if ('consumes' in path) {
                            path.consumes.forEach(consumes.add.bind(produces))
                        }

                        if ('schemes' in path) {
                            tmpEndP.schemes = path.schemes?.map((s) => {
                                return { key: s.toLowerCase(), val: s };
                            }) || [];
                        }

                        if (path.parameters) {
                            let parsedParams = OASUtils.parsePathParams(path.parameters || [], proj);
                            tmpEndP.traits = [...tmpEndP.traits, ...parsedParams.traits];
                            tmpEndP.body = parsedParams.body;
                            ['queryParams', 'pathParams', 'headers'].forEach(pType => {
                                tmpEndP[pType] = {
                                    properties: { ...tmpEndP[pType].properties, ...parsedParams[pType].properties },
                                    type: ['object'],
                                    required: [...tmpEndP[pType].required, ...parsedParams[pType].required]
                                }
                            })
                        }

                        //for OAS3 parse bodyParam
                        if ('requestBody' in path && path.requestBody && 'content' in path.requestBody) {
                            let reqBodyContent = path.requestBody.content; //currently apic only supports single body type per endpoint
                            //TODO: Add support for multiple body types
                            //TODO: Add support for body examples
                            let [contentType, schemaData] = Utils.objectEntries(reqBodyContent)[0] ?? [];
                            if (contentType && schemaData) {
                                consumes.add(contentType);
                                let body: {
                                    type: 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'graphql',
                                    data: any
                                } = {
                                    type: "raw", data: {}
                                }
                                switch (contentType) {
                                    case 'multipart/form-data':
                                    case 'application/x-www-form-urlencoded':
                                        body.type = contentType === 'multipart/form-data' ? 'form-data' : 'x-www-form-urlencoded';
                                        //TODO:Test this
                                        if ('$ref' in schemaData.schema) {
                                            body.data = schemaData.schema;
                                        } else {
                                            let required = schemaData.schema?.required || [];
                                            body.data = Utils.objectEntries(schemaData.schema?.properties)
                                                .filter(([name, detail]) => 'type' in detail)
                                                .map(([name, detail]) => {
                                                    return {
                                                        key: name,
                                                        type: 'type' in detail ? (detail.format == 'binary' ? 'file' : detail.type) : 'string',
                                                        required: required.includes(name),
                                                        desc: detail.description
                                                    }
                                                })
                                        }
                                        break
                                    default:
                                        body.data = schemaData.schema;
                                }
                                tmpEndP.body = body
                            }
                        }

                        if (path.responses) {
                            for (const [statusCode, resp] of Utils.objectEntries(path.responses as { [key: string]: any })) {
                                let moveRespToTrait = false, refName;
                                if ('$ref' in resp) {
                                    let ref = resp.$ref;
                                    let traitName = ref.substring(ref.lastIndexOf('/') + 1, ref.length);
                                    refName = traitName;
                                    if (traitName.indexOf('trait') === 0 && (traitName.match(/\./g) || []).length === 2) {
                                        let refSplit = ref.split('.');
                                        traitName = refSplit[1];
                                        if (refSplit[2]?.match(/^\d+$/)) {
                                            moveRespToTrait = true;
                                        }
                                        refName = refSplit[2];
                                    }

                                    if (moveRespToTrait) {
                                        let trait = Utils.objectValues(proj.traits).find(t => t.name === traitName);
                                        if (trait) {//if trait not added then push it
                                            var existing = false;
                                            for (var j = 0; j < tmpEndP.traits.length; j++) {
                                                if (tmpEndP.traits[j]._id === trait._id) {
                                                    existing = true;
                                                    break;
                                                }
                                            }
                                            if (!existing) {
                                                tmpEndP.traits.push({ _id: trait._id, name: trait.name });
                                            }
                                        } else {
                                            console.error(`Unresolved $ref ${ref}`)
                                        }
                                    }
                                }

                                if (!('$ref' in resp) || !moveRespToTrait) {
                                    //TODO: Add support for response headers
                                    if ('content' in resp) { //for OAS3
                                        let content = resp.content;
                                        Utils.objectEntries(content as { [media: string]: OpenAPIV3_1.MediaTypeObject }).forEach(([mimetype, schemaObj], index) => {
                                            produces.add(mimetype);
                                            let tmpResp: ApiResponse = {
                                                //TODO: test this
                                                // data: ('$ref' in resp) ? ({ $ref: resp. $ref.substring(0, resp. $ref.lastIndexOf('/') + 1) + refName )) (resp
                                                desc: ('description' in resp) ? resp.description : '',
                                                code: statusCode + (index > 0 ? `-${index}` : ''),
                                                data: schemaObj.schema,
                                                examples: []
                                            };
                                            //parse examples
                                            let parsedExamples = OASUtils.parseResponseExamples(schemaObj, proj, `${path.summary}-${statusCode}`);
                                            tmpResp.examples = parsedExamples.exampleRefs;
                                            examples = [...examples, ...parsedExamples.examples];

                                            //if exact same response already exists but just has a different content type dont add it again
                                            if (!tmpEndP.responses.find(resp => Utils.deepEquals(resp.data, schemaObj.schema) && statusCode === resp.code)) {
                                                tmpEndP.responses.push(tmpResp);
                                            }
                                        })
                                    } else { //For OAS2
                                        let tmpResp: ApiResponse = {
                                            data: ('$ref' in resp) ? ({ $ref: resp.$ref.substring(0, resp.$ref.lastIndexOf('/') + 1) + refName }) : (resp.schema || { type: 'object' }),
                                            desc: ('description' in resp) ? resp.description : '',
                                            code: statusCode,
                                            examples: []
                                        };
                                        tmpEndP.responses.push(tmpResp);
                                    }
                                }
                            }
                        }

                        if (path.security) {
                            tmpEndP.security = [];
                            path.security.forEach((sec) => {
                                tmpEndP.security.push({ name: Object.keys(sec)[0] });
                            })
                        }
                        tmpEndP.consumes = Array.from(consumes).filter(mime => mime !== '*/*');
                        tmpEndP.produces = Array.from(produces).filter(mime => mime !== '*/*');;
                        endpoints.push(tmpEndP);
                    };
                };
            }
        }
        return {
            folders: folders.reduce((obj, f) => {
                const key = f._id;
                return ({ ...obj, [key]: f })
            }, {}),
            endpoints: endpoints.reduce((obj, endp) => {
                const key = endp._id;
                return ({ ...obj, [key]: endp })
            }, {}),
            examples: examples.reduce((obj, ex) => {
                const key = ex._id;
                return ({ ...obj, [key]: ex })
            }, {}),
        }
    }

    static parsePathParams(parameters: OpenAPI.Parameters, proj: ApiProject) {
        let parsedParams = {
            headers: {
                properties: {},
                type: ['object'],
                required: []
            },
            queryParams: {
                properties: {},
                type: ['object'],
                required: []
            },
            pathParams: {
                properties: {},
                type: ['object'],
                required: []
            },
            body: null,
            traits: []
        }
        for (let i = 0; i < parameters?.length; i++) {
            var param = parameters[i];
            var ptype = undefined;
            if ('in' in param) {
                switch (param.in) {
                    case 'header':
                        ptype = 'headers';
                        break;
                    case 'query':
                        ptype = 'queryParams';
                        break;
                    case 'path':
                        ptype = 'pathParams';
                        break;
                    case 'body':
                        ptype = 'body';
                        break;
                    case 'formData':
                        ptype = 'formData';
                        break;
                    default:
                        if (('ref' in param)) {
                            console.error('not supported', param);
                        }
                }
                let schema = 'schema' in param ? (param as OpenAPIV3_1.ParameterBaseObject).schema : param as (OpenAPIV2.InBodyParameterObject | OpenAPIV2.GeneralParameterObject);
                if (['headers', 'queryParams', 'pathParams'].indexOf(ptype) >= 0) {
                    //if not a Sref
                    if ('$ref' in schema) {
                        parsedParams[ptype].properties[param.name] = schema
                    } else {
                        parsedParams[ptype].properties[param.name] = {
                            type: schema.type,
                            default: schema.default ?? "",
                            description: param.description || schema.description || ''
                        };
                        if ('items' in schema) {
                            parsedParams[ptype].properties[param.name].items = schema.items;
                        }
                        if (param.required) {
                            parsedParams[ptype].required.push(param.name);
                        }
                    }
                } else if (ptype == 'body') { //applicable for OAS2
                    parsedParams.body = {
                        type: 'raw',
                        data: Object.assign({}, param.schema)
                    };
                } else if (ptype === 'formData') { //applicable for QAS2
                    parsedParams.body = {
                        data: [],
                        type: 'x-www-form-urlencoded'
                    };
                    if ('$ref' in schema) {
                        //TODO:

                    } else {
                        parsedParams.body.data.push({
                            key: param.name,
                            type: schema.type,
                            desc: param.description,
                            required: param.required
                        });
                        if (schema.type === 'file') {
                            parsedParams.body.type = 'form-data';
                        }
                    }
                }
            } else if (param.$ref) {
                let ref = param.$ref;
                let traitName = ref.substring(ref.lastIndexOf('/') + 1, ref.length);
                if (traitName.indexOf('trait') === 0 && (traitName.match(/\./g) || []).length === 2) {
                    traitName = ref.split('.')[1];
                }
                let trait = Utils.objectValues(proj.traits).find(t => t.name === traitName); if (trait) {//if trait not added then push it
                    let existing = false;
                    for (let j = 0; j < parsedParams.traits.length; j++) {
                        if (parsedParams.traits[j]._id = trait._id) {
                            existing = true; break;
                        }
                    }
                    if (!existing) {
                        parsedParams.traits.push({ _id: trait._id, name: trait.name });
                    }
                } else {
                    console.error(`Unresolved $ref: ${ref}`);
                }
            }
        }
        return parsedParams;
    }

    static parseResponseExamples(schemaObj: OpenAPIV3_1.MediaTypeObject, proj: ApiProject, pathName: string) {
        let examples: ApiExample[] = []
        let exampleRefs: ApiExampleRef[] = [];
        let specExamples = schemaObj.examples || (schemaObj.example ? { [`eg.${pathName}`]: { value: schemaObj.example } } : null)

        if (specExamples) {
            exampleRefs = Utils.objectEntries(specExamples).map(([name, specExample]) => {
                if (`$ref` in specExample) {
                    let refName = specExample.$ref.substring(specExample.$ref.lastIndexOf('/') + 1);
                    let resolvedRef: ApiExample = Utils.objectValues(proj.examples).find(ex => ex.name === refName);
                    return { key: name, val: resolvedRef._id }
                } else {
                    let example: ApiExample = {
                        _id: apic.s12(),
                        name: name.replace(/\s/g, '_'),
                        summary: specExample.summary || '',
                        folder: Utils.objectValues(proj.folders).find(f => f.name == 'Examples')._id,
                        description: specExample.description
                    }
                    if (specExample.externalValue) {
                        example.valueType = 'external';
                        example.value = specExample.externalValue;
                    } else {
                        example.valueType = 'inline';
                        example.value = specExample.value
                    }
                    examples.push(example);
                    return { key: name, val: example._id };
                }
            })
        }
        return {
            examples,
            exampleRefs
        }
    }

}
