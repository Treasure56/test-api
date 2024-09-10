import { openai } from "@/lib/openai";
import { NextRequest, NextResponse } from "next/server";
import { z, ZodTypeAny } from "zod";
import { EXAMPLE_ANSWER, EXAMPLE_PROMPT } from "./example";

const determineSchemaType = (schema: any) => {
  // {type: "string"}
  if (!schema.hasOwnProperty("type")) {
    if (Array.isArray(schema)) {
      return "array";
    } else {
      return typeof schema; //"string" | number |
    }
  }

  return schema.type;
};

const jsonSchemaToZod = (schema: any): ZodTypeAny => {
  const type = determineSchemaType(schema);

  switch (type) {
    case "string":
      return z.string().nullable();
    case "number":
      return z.number().nullable();
    case "boolean":
      return z.boolean().nullable();
    case "array":
      return z.array(jsonSchemaToZod(schema.items)).nullable();
    case "object":
      const shape: Record<string, ZodTypeAny> = {};
      for (const key in schema) {
        if (key !== "type") {
          shape[key] = jsonSchemaToZod(schema[key]);
        }
      }
      return z.object(shape);

    default:
      throw new Error(`unsupported type: ${type}`);
  }
};


  type PromiseExecutor<T> = (
    resolve: (value: T) => void,
    reject: (reason?: any) => void
  ) => void;
  class RetryablePromise<T> extends Promise<T> {
    static async retry<T>(
      retries: number,
      executor: PromiseExecutor<T>
    ): Promise<T> {
      return new RetryablePromise(executor).catch((error) => {
        console.error(`Retrying due to error ${error}`);

        return retries > 0
          ? RetryablePromise.retry(retries - 1, executor)
          : Promise.reject(error);
      });
    }
  }
export async function POST(req: NextRequest) {
  const body = await req.json();

  // data; format
  // step 1: make sure incoming request is valid
  const genericShema = z.object({
    data: z.string(),
    format: z.object({}).passthrough(),
  });

  const { data, format } = genericShema.parse(body);

  //step 2: create a schema from the expected user format
  const dynamicschema = jsonSchemaToZod(format);

  // step 3: retry mechanism



  const validationResult = await RetryablePromise.retry(
    5,
    async (resolve, reject) => {
      try {
        // call ai

        const content = `DATA: \n"${data}"\n\n-----------\nExpected JSON format:
      ${JSON.stringify(format, null, 2)} 

}
\n\n-----------\nValid JSON output in expected format:`;
        const res = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "assistant",
              content:
                "You are an AI that converts data into the attached JSON format. You respond with nothing but valid JSON based on the input data. Your output should DIRECTLY be valid json, nothing added before and after. You will begin with the opening curly brace and end with the closing brace. Only if you absolutly cannot determine a field, use the value 'null'.",
            },
            {
              role: "user",
              content: EXAMPLE_PROMPT,
            },
            {
              role: "user",
              content: EXAMPLE_ANSWER,
            },
          ],
        });

        const text = res.choices[0].message.content;
        // validate json
        const validationResult = dynamicschema.parse(text || "");

        return resolve(validationResult);
      } catch (err) {
        reject(err);
      }
    }
  );

  return NextResponse.json(validationResult, {
    status: 200,
  });
}
